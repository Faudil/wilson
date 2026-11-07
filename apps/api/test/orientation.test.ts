import { afterAll, describe, expect, it, vi } from "vitest";
import type { KnowledgeHit, KnowledgeSourceId } from "@wilson/contracts";
import { LetterAnalysisSchema } from "@wilson/contracts";
import { AnthropicProvider, type AnthropicLike } from "../src/llm/anthropic.js";
import { FakeProvider } from "../src/llm/fake.js";
import { LlmError } from "../src/llm/provider.js";
import type { KnowledgeSearchQuery, KnowledgeService } from "../src/knowledge/types.js";
import { buildRagQuery } from "../src/letters/ragQuery.js";
import { ORIENTATION_WARNING } from "../src/letters/service.js";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSamplesDir } from "../src/llm/fake.js";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const OFFICE = "Point-justice du 11e arrondissement";

class FakeKnowledge implements KnowledgeService {
  searches: KnowledgeSearchQuery[] = [];
  failSearch = false;
  constructor(private readonly empty = false) {}
  async listSources() {
    return [];
  }
  async search(q: KnowledgeSearchQuery): Promise<KnowledgeHit[]> {
    this.searches.push(q);
    if (this.failSearch) throw new Error("db down");
    if (this.empty || q.kinds?.[0] !== "contact") return [];
    return [{ id: ID1, sourceId: "annuaire", kind: "contact", title: OFFICE, url: "https://example.org/pj", department: "75", excerpt: "x", score: 1 }];
  }
  async sync(): Promise<number> {
    return 0;
  }
  async getChunks(ids: string[]) {
    return ids.includes(ID1)
      ? [{ id: ID1, sourceId: "annuaire" as KnowledgeSourceId, title: OFFICE, url: "https://example.org/pj", text: "Consultation juridique gratuite, 12 rue Exemple, 75011 Paris.\nTél 01 00 00 00 00" }]
      : [];
  }
}

const oqtf = () => sampleFile("letters", "02-prefecture-oqtf.png");

async function run(knowledge: KnowledgeService, phone: string) {
  const t = await makeE2E({ knowledge });
  const p = t.phone(phone);
  await p.say("Hello, I need help");
  await p.say("1");
  await p.send(oqtf());
  const id = await beneficiaryIdOf(t, phone);
  const page = await t.client.letters.list({ limit: 50 });
  const item = page.items.find((l) => l.beneficiaryId === id)!;
  return { t, item, detail: await t.client.letters.get({ id: item.id }) };
}

const toClose: E2E[] = [];
afterAll(async () => {
  for (const t of toClose) await t.close();
});

describe("orientation step in the letters pipeline", () => {
  it("enriches the OQTF orientation, sets sources, and the outgoing text names the office", async () => {
    const k = new FakeKnowledge();
    const { t, detail } = await run(k, "33612990001");
    toClose.push(t);
    expect(detail.status).toBe("pending_review");
    expect(detail.analysis!.fr.orientation.some((l) => l.includes(OFFICE))).toBe(true);
    expect(detail.analysis!.sources).toEqual([{ chunkId: ID1, sourceId: "annuaire", title: OFFICE, url: "https://example.org/pj" }]);
    expect(detail.outgoingText).toContain(OFFICE);
    expect(detail.history.some((h) => h.note === "orientation enrichie: 1 sources")).toBe(true);
    expect(detail.analysis!.reviewerWarnings).not.toContain(ORIENTATION_WARNING);
    // procedures + contacts, department 75, limit 4, query uses the OQTF hint
    expect(k.searches).toHaveLength(2);
    expect(k.searches[0]).toMatchObject({ department: "75", limit: 4, kinds: ["procedure"] });
    expect(k.searches[0]!.query).toContain("point-justice");
  });

  it("empty knowledge base: orientation unchanged, no sources, no warning", async () => {
    const { t, detail } = await run(new FakeKnowledge(true), "33612990002");
    toClose.push(t);
    expect(detail.analysis!.sources).toBeUndefined();
    expect(detail.analysis!.fr.orientation.join(" ")).not.toContain(OFFICE);
    expect(detail.analysis!.reviewerWarnings).not.toContain(ORIENTATION_WARNING);
  });

  it("search failure: letter still pending_review with the warning and the original orientation", async () => {
    const k = new FakeKnowledge();
    k.failSearch = true;
    const { t, detail } = await run(k, "33612990003");
    toClose.push(t);
    expect(detail.status).toBe("pending_review");
    expect(detail.analysis!.reviewerWarnings).toContain(ORIENTATION_WARNING);
    expect(detail.analysis!.sources).toBeUndefined();
    expect(detail.analysis!.fr.orientation.join(" ")).not.toContain(OFFICE);
  });

  it("ragQuery adds the French hint for the letter type", () => {
    const a = LetterAnalysisSchema.parse(JSON.parse(readFileSync(join(resolveSamplesDir(), "letters", "02-prefecture-oqtf.expected.json"), "utf8")));
    expect(buildRagQuery(a)).toContain("obligation de quitter le territoire");
  });
});

describe("FakeProvider.orientLetter", () => {
  it("keeps the association line and adds the top snippet", async () => {
    const a = LetterAnalysisSchema.parse(JSON.parse(readFileSync(join(resolveSamplesDir(), "letters", "02-prefecture-oqtf.expected.json"), "utf8")));
    const f = new FakeProvider();
    const assoc = { name: "A", contact: "c" };
    const snippet = { id: ID1, title: OFFICE, text: "Ligne un\nLigne deux", url: null };
    const out = await f.orientLetter({ analysis: a, targetLanguage: "ar", association: assoc, snippets: [snippet] });
    expect(out.usedIds).toEqual([ID1]);
    expect(out.fr[0]).toBe(a.fr.orientation[0]);
    expect(out.fr[1]).toBe(`${OFFICE} : Ligne un`);
    expect(out.target[1]).toBe(`[ar] ${OFFICE} : Ligne un`);
    const en = await f.orientLetter({ analysis: a, targetLanguage: "en", association: assoc, snippets: [snippet] });
    expect(en.target[1]).toBe(`${OFFICE} : Ligne un`);
    const none = await f.orientLetter({ analysis: a, targetLanguage: "ar", association: assoc, snippets: [] });
    expect(none).toEqual({ fr: a.fr.orientation, target: a.target.orientation, usedIds: [] });
  });
});

describe("AnthropicProvider.orientLetter (mocked SDK)", () => {
  const a = LetterAnalysisSchema.parse(JSON.parse(readFileSync(join(resolveSamplesDir(), "letters", "02-prefecture-oqtf.expected.json"), "utf8")));
  const input = {
    analysis: a,
    targetLanguage: "en" as const,
    association: { name: "Asso", contact: "01" },
    snippets: [{ id: ID1, title: OFFICE, text: "texte", url: null }],
  };
  const reply = (obj: unknown) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] });
  const provider = (create: ReturnType<typeof vi.fn>) =>
    new AnthropicProvider({ model: "m", client: { messages: { create } } as unknown as AnthropicLike });

  it("drops unknown usedIds", async () => {
    const create = vi.fn().mockResolvedValue(reply({ fr: ["Asso", OFFICE], target: ["Asso", OFFICE], usedIds: [ID1, ID2, ID1] }));
    const out = await provider(create).orientLetter(input);
    expect(out.usedIds).toEqual([ID1]);
    expect(create.mock.calls[0]![0].messages[0].content[0].text).toContain(OFFICE);
  });

  it("rejects mismatched lengths (after the repair retry)", async () => {
    const create = vi.fn().mockResolvedValue(reply({ fr: ["a", "b"], target: ["a"], usedIds: [] }));
    await expect(provider(create).orientLetter(input)).rejects.toBeInstanceOf(LlmError);
  });

  it("rejects an empty or oversized list", async () => {
    const create = vi.fn().mockResolvedValue(reply({ fr: [], target: [], usedIds: [] }));
    await expect(provider(create).orientLetter(input)).rejects.toBeInstanceOf(LlmError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
