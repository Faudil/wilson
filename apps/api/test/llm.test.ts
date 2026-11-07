import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "bun:test";
import { DocumentAnalysisSchema, LANGUAGE_CODES, LetterAnalysisSchema, type LanguageCode } from "@wilson/contracts";
import { AnthropicProvider, type AnthropicLike } from "../src/llm/anthropic.js";
import { FakeProvider, resolveSamplesDir } from "../src/llm/fake.js";
import { LlmError } from "../src/llm/provider.js";
import { createLlmProvider } from "../src/llm/index.js";
import { loadPrompt, promptVersion, renderPrompt, type PromptName } from "../src/llm/prompts.js";

const samples = resolveSamplesDir();
const lettersDir = join(samples, "letters");
const docsDir = join(samples, "documents");
const slugs = readdirSync(lettersDir).sort().filter((f) => f.endsWith(".expected.json")).map((f) => f.replace(".expected.json", ""));
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("sample letters", () => {
  it("has 10 letters with md, html, png", () => {
    expect(slugs).toHaveLength(10);
    for (const s of slugs) for (const ext of ["md", "html", "png"]) expect(() => readFileSync(join(lettersDir, `${s}.${ext}`))).not.toThrow();
  });
  for (const s of slugs) {
    it(`${s}: valid analysis, orientation, verbatim quote`, () => {
      const json = readJson(join(lettersDir, `${s}.expected.json`));
      const a = LetterAnalysisSchema.parse(json);
      expect(a.fr.orientation.length).toBeGreaterThanOrEqual(1);
      expect(a.target.orientation.length).toBeGreaterThanOrEqual(1);
      for (const l of ["en", "ar"]) {
        expect(json.targets[l].orientation.length).toBeGreaterThanOrEqual(1);
        expect(json.targets[l].actions).toHaveLength(a.fr.actions.length);
      }
      const md = readFileSync(join(lettersDir, `${s}.md`), "utf8");
      if (a.deadline) expect(md).toContain(a.deadline.sourceQuote);
      for (const r of a.references) expect(md).toContain(r);
    });
  }
  it("removal order and OFPRA rejection are urgent with a lawyer/association first orientation", () => {
    for (const s of ["02-prefecture-oqtf", "04-ofpra-rejet-cnda"]) {
      const a = LetterAnalysisSchema.parse(readJson(join(lettersDir, `${s}.expected.json`)));
      expect(a.urgency).toBe("high");
      expect(a.deadline?.kind).toBe("appeal");
      expect(a.deadline?.explicit).toBe(false);
      expect(a.reviewerWarnings.length).toBeGreaterThan(0);
    }
  });
  it("document fixtures validate", () => {
    const files = readdirSync(docsDir).filter((f) => f.endsWith(".expected.json"));
    expect(files).toHaveLength(3);
    for (const f of files) DocumentAnalysisSchema.parse(readJson(join(docsDir, f)));
  });
});

describe("FakeProvider", () => {
  const fake = new FakeProvider();
  const file = (p: string) => ({ bytes: readFileSync(p), mimeType: "image/png" });
  for (const s of slugs) {
    it(`${s}: returns its fixture`, async () => {
      const exp = readJson(join(lettersDir, `${s}.expected.json`));
      const en = await fake.analyzeLetter({ file: file(join(lettersDir, `${s}.png`)), targetLanguage: "en", today: "2026-11-06" });
      expect(en.letterType).toBe(exp.letterType);
      expect(en.deadline).toEqual(exp.deadline);
      expect(en.target).toEqual(exp.targets.en);
      const ar = await fake.analyzeLetter({ file: file(join(lettersDir, `${s}.png`)), targetLanguage: "ar", today: "2026-11-06" });
      expect(ar.target).toEqual(exp.targets.ar);
      LetterAnalysisSchema.parse(ar);
    });
  }
  it("uses fa text where present, prefixed French otherwise, plain French for fr", async () => {
    const f1 = file(join(lettersDir, `${slugs[0]}.png`));
    const fa = await fake.analyzeLetter({ file: f1, targetLanguage: "fa", today: "2026-11-06" });
    expect(fa.target.title).toMatch(/ولایت/);
    const f2 = file(join(lettersDir, `${slugs[1]}.png`));
    const ps = await fake.analyzeLetter({ file: f2, targetLanguage: "ps", today: "2026-11-06" });
    expect(ps.target.title.startsWith("[ps] ")).toBe(true);
    const fr = await fake.analyzeLetter({ file: f2, targetLanguage: "fr", today: "2026-11-06" });
    expect(fr.target).toEqual(fr.fr);
  });
  it("returns a generic low-confidence analysis for unknown files", async () => {
    const a = await fake.analyzeLetter({ file: { bytes: Buffer.from("nope"), mimeType: "image/png" }, targetLanguage: "so", today: "2026-11-06" });
    expect(a.letterType).toBe("other_official");
    expect(a.confidence).toBeLessThan(0.6);
    expect(a.target.title.startsWith("[so] ")).toBe(true);
  });
  it("analyzes sample documents", async () => {
    const r = await fake.analyzeDocument({ file: file(join(docsDir, "d1-recepisse.png")), today: "2026-11-06" });
    expect(r.type).toBe("recepisse");
    expect(r.expiresAt).toBe("2027-03-14");
    expect((await fake.analyzeDocument({ file: { bytes: Buffer.from("x"), mimeType: "image/png" }, today: "2026-11-06" })).type).toBe("other");
  });
  it("detects languages", async () => {
    const cases: [string, LanguageCode | null][] = [
      ["Bonjour, j'ai reçu un courrier", "fr"],
      ["Hello, I need help with a letter please", "en"],
      ["مرحبا أريد مساعدة", "ar"],
      ["سلام من یک نامه دارم", "fa"],
      ["سلام زه مرسته غواړم ښه", "ps"],
      ["مجھے ایک خط ملا ہے ٹھیک", "ur"],
      ["Добрий день, у мене лист", "uk"],
      ["Salaan, waan rabaa kaalmo fadlan", "so"],
      ["ሰላም እንዴት ነህ", "am"],
      ["12345", null],
    ];
    for (const [text, lang] of cases) expect((await fake.detectLanguage({ text })).language).toBe(lang);
  });
  it("fake-translates by prefix", async () => {
    const fr = { title: "T", summary: "S", actions: ["a"], orientation: ["o"] };
    const out = await fake.translateLetterText({ fr, targetLanguage: "uk" });
    expect(out).toEqual({ title: "[uk] T", summary: "[uk] S", actions: ["[uk] a"], orientation: ["[uk] o"] });
  });
  it("createLlmProvider returns fake in fake mode", () => {
    expect(createLlmProvider({ LLM_MODE: "fake", ANTHROPIC_API_KEY: undefined, LLM_MODEL: "m" }).name).toBe("fake");
    expect(createLlmProvider({ LLM_MODE: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL: "m" }).name).toBe("anthropic");
  });
});

describe("prompts", () => {
  const names: PromptName[] = ["letter-analysis", "document-analysis", "language-detect", "letter-translate"];
  it("load and have a version string", () => {
    for (const n of names) expect(loadPrompt(n).length).toBeGreaterThan(200);
    expect(promptVersion("letter-analysis")).toBe("letter-analysis@1");
  });
  it("letter-analysis enforces the no-legal-advice rules", () => {
    const p = renderPrompt("letter-analysis", { today: "2026-11-06", targetLanguageName: "Arabic", targetLanguageCode: "ar" });
    expect(p).toContain("NO legal advice");
    expect(p).toContain("OQTF");
    expect(p).toContain("reviewerWarnings");
    expect(p).toContain("character for character");
    expect(p).toContain("Arabic");
    expect(p).toContain("2026-11-06");
    expect(p).not.toMatch(/\{\{/);
  });
  it("throws on a missing variable", () => {
    expect(() => renderPrompt("letter-analysis", { today: "x" })).toThrow(/Missing prompt variable/);
  });
  it("language-detect lists all codes", () => {
    const p = renderPrompt("language-detect", { languageList: LANGUAGE_CODES.join(","), text: "hi" });
    for (const c of LANGUAGE_CODES) expect(p).toContain(c);
  });
});

describe("AnthropicProvider (mocked SDK)", () => {
  const validJson = readFileSync(join(lettersDir, `${slugs[0]}.expected.json`), "utf8");
  const reply = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" }) as never;
  const mk = (create: ReturnType<typeof vi.fn>) =>
    new AnthropicProvider({ model: "test-model", client: { messages: { create } } as unknown as AnthropicLike });
  const input = { file: { bytes: Buffer.from("png-bytes"), mimeType: "image/png" }, targetLanguage: "en" as const, today: "2026-11-06" };

  it("accepts valid JSON (even fenced) and builds image + prompt blocks", async () => {
    const create = vi.fn().mockResolvedValue(reply("```json\n" + validJson + "\n```"));
    const a = await mk(create).analyzeLetter(input);
    expect(a.letterType).toBe("prefecture_residence_permit");
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0];
    expect(params.model).toBe("test-model");
    const content = params.messages[0].content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png-bytes").toString("base64") } });
    expect(content[1].text).toContain("English");
  });
  it("sends PDFs as document blocks", async () => {
    const create = vi.fn().mockResolvedValue(reply(validJson));
    await mk(create).analyzeLetter({ ...input, file: { bytes: Buffer.from("%PDF"), mimeType: "application/pdf" } });
    expect(create.mock.calls[0]![0].messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
  });
  it("repairs once: invalid JSON then valid", async () => {
    const create = vi.fn().mockResolvedValueOnce(reply("not json")).mockResolvedValueOnce(reply(validJson));
    const a = await mk(create).analyzeLetter(input);
    expect(a.promptVersion).toBe("letter-analysis@1");
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1]![0].messages;
    expect(second).toHaveLength(3);
    expect(second[2].content).toContain("rejected by the validator");
  });
  it("feeds the Zod error back on schema failure, then throws LlmError after exactly one retry", async () => {
    const bad = JSON.stringify({ ...JSON.parse(validJson), urgency: "extreme" });
    const create = vi.fn().mockResolvedValue(reply(bad));
    await expect(mk(create).analyzeLetter(input)).rejects.toBeInstanceOf(LlmError);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0].messages[2].content).toContain("urgency");
  });
  it("wraps API errors in LlmError without retrying", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(mk(create).analyzeLetter(input)).rejects.toBeInstanceOf(LlmError);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("detectLanguage maps unknown to null; document analysis validates", async () => {
    const c1 = vi.fn().mockResolvedValue(reply('{"language":"unknown","confidence":0.2}'));
    expect(await mk(c1).detectLanguage({ text: "ok" })).toEqual({ language: null, confidence: 0.2 });
    const c2 = vi.fn().mockResolvedValue(reply(readFileSync(join(docsDir, "d1-recepisse.expected.json"), "utf8")));
    expect((await mk(c2).analyzeDocument({ file: input.file, today: "2026-11-06" })).type).toBe("recepisse");
  });
  it("translateLetterText keeps entry counts", async () => {
    const fr = { title: "T", summary: "S", actions: ["a", "b"], orientation: ["o"] };
    const ok = vi.fn().mockResolvedValue(reply(JSON.stringify({ title: "t", summary: "s", actions: ["x", "y"], orientation: ["z"] })));
    expect((await mk(ok).translateLetterText({ fr, targetLanguage: "ar" })).actions).toHaveLength(2);
    const bad = vi.fn().mockResolvedValue(reply(JSON.stringify({ title: "t", summary: "s", actions: ["x"], orientation: ["z"] })));
    await expect(mk(bad).translateLetterText({ fr, targetLanguage: "ar" })).rejects.toBeInstanceOf(LlmError);
  });
  it("uses fastModel for the calls a WhatsApp reply waits on, the main model for the rest", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(reply('{"intent":"info","frenchQuery":"q","needsHuman":false}'))
      .mockResolvedValueOnce(reply("bonjour"))
      .mockResolvedValueOnce(reply('{"language":"fr","confidence":0.9}'))
      .mockResolvedValueOnce(reply(validJson));
    const llm = new AnthropicProvider({ model: "main", fastModel: "fast", client: { messages: { create } } as unknown as AnthropicLike });
    await llm.planChat({ history: [{ role: "beneficiary", text: "salut" }], language: "fr" });
    await llm.translateText({ text: "hello", from: "en", to: "fr" });
    await llm.detectLanguage({ text: "bonjour" });
    await llm.analyzeLetter(input);
    expect(create.mock.calls.map((c) => c[0].model)).toEqual(["fast", "fast", "fast", "main"]);
    // Without fastModel everything stays on the main model.
    const one = vi.fn().mockResolvedValue(reply("bonjour"));
    await mk(one).translateText({ text: "hello", from: "en", to: "fr" });
    expect(one.mock.calls[0]![0].model).toBe("test-model");
  });
});

it("sample hashes are stable keys (sanity)", () => {
  const h = createHash("sha256").update(readFileSync(join(lettersDir, `${slugs[0]}.png`))).digest("hex");
  expect(h).toHaveLength(64);
});
