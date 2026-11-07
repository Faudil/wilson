import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { FakeProvider } from "../src/llm/fake.js";
import type { ChatTurn } from "../src/llm/provider.js";
import { and, eq } from "drizzle-orm";
import { accessLog, beneficiaries, messages } from "../src/db/schema.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Knowledge dir with one association note, so retrieval finds something in tests. */
function knowledgeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wilson-kb-"));
  mkdirSync(join(dir, "association"));
  writeFileSync(
    join(dir, "association", "permanences.md"),
    "---\ntitle: Permanences de l'association\nkind: procedure\nurl: https://example.org/permanences\n---\n# Permanences de l'association\n\n## Titre de séjour\n\nPour le renouvellement du titre de séjour, venez à la permanence du mardi avec votre récépissé et votre passeport.\n",
  );
  return dir;
}

async function setup(chatMode: "review" | "auto", lang: "en" | "ar" | "fr" = "en", phone = "33620000001") {
  t = await makeE2E({ config: { CHAT_MODE: chatMode, KNOWLEDGE_DIR: knowledgeDir(), KNOWLEDGE_ENABLE: "" } });
  await t.services.knowledge.sync("association");
  const p = t.phone(phone);
  await p.say("?");
  await p.say(String(LANGUAGE_CODES.indexOf(lang) + 1));
  const bid = await beneficiaryIdOf(t, phone);
  return { p, bid, phone };
}

/** Strip bidi isolates and RLM so assertions read naturally. */
const plain = (s: string) => s.replace(/[\u2066-\u2069\u200f]/g, "");
const fixed = (lang: "en" | "ar" | "fr", key: Parameters<typeof waText>[1]) => plain(waText(lang, key));

const footer = (e: E2E, lang: "en" | "ar" | "fr") => waText(lang, "footer", { name: e.config.ASSOCIATION_NAME, contact: e.config.ASSOCIATION_CONTACT });

describe("chatbot", () => {
  it("menu 4 shows the chat intro; menu words and digits still work from the chat", async () => {
    const { p } = await setup("review");
    await p.say("4");
    expect(await p.last()).toBe(waText("en", "chat_intro"));
    await p.say("menu");
    expect(await p.last()).toBe(waText("en", "main_menu"));
    await p.say("4");
    await p.say("0");
    expect(await p.last()).toContain(t!.config.ASSOCIATION_NAME);
  });

  it("review mode: info question becomes a draft + chat_pending; approving sends it with the footer; sources are stored", async () => {
    const { p, bid } = await setup("review");
    await p.say("4");
    await p.say("Comment renouveler mon titre de séjour ?");
    const out = await p.out();
    expect(out.at(-1)!.startsWith(waText("en", "chat_pending"))).toBe(true);
    expect(out.at(-1)!.endsWith(footer(t!, "en"))).toBe(true);
    const before = out.length;

    let conv = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(conv.status).toBe("pending_review");
    expect(conv.pendingDrafts).toBe(1);
    const draft = conv.messages.find((m) => m.state === "draft")!;
    expect(draft.author).toBe("bot");
    expect(draft.intent).toBe("info");
    expect(draft.sources.length).toBeGreaterThan(0);
    expect(draft.sources[0]!.url).toBe("https://example.org/permanences");
    expect(draft.textFr).toContain(t!.config.ASSOCIATION_NAME);
    // the beneficiary's message is shown in French for volunteers
    expect(conv.messages.find((m) => m.author === "beneficiary")!.textFr).toBe("[fr] Comment renouveler mon titre de séjour ?");

    // a second question in the same batch does not send chat_pending again
    await p.say("Où est la préfecture ?");
    expect((await p.out()).filter((x) => x.startsWith(waText("en", "chat_pending"))).length).toBe(1);

    conv = await t!.client.conversations.approveDraft({ messageId: draft.id });
    await t!.queue.drain();
    const sent = conv.messages.find((m) => m.id === draft.id)!;
    expect(sent.state).toBe("sent");
    const outAfter = await p.out();
    expect(outAfter.length).toBeGreaterThan(before);
    expect(outAfter).toContain(draft.text);
    expect(draft.text.endsWith(footer(t!, "en"))).toBe(true);
    // no duplicate row for the same send
    expect(outAfter.filter((x) => x === draft.text).length).toBe(1);
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).pendingDrafts).toBe(1);
  });

  it("approving an edited French draft re-translates it before sending; rejecting never sends", async () => {
    const { p, bid } = await setup("review", "ar", "33620000002");
    await p.say("4");
    await p.say("كيف أجدد إقامتي؟"); // fake: info
    const conv = await t!.client.conversations.get({ beneficiaryId: bid });
    const draft = conv.messages.find((m) => m.state === "draft")!;
    await t!.client.conversations.approveDraft({ messageId: draft.id, textFr: "Venez mardi à la permanence." });
    await t!.queue.drain();
    const last = plain(await p.last());
    expect(last).toContain("[ar] Venez mardi à la permanence.");
    expect(last).toContain(t!.config.ASSOCIATION_NAME);

    await p.say("وين أروح؟");
    const c2 = await t!.client.conversations.get({ beneficiaryId: bid });
    const d2 = c2.messages.find((m) => m.state === "draft")!;
    const n = (await p.out()).length;
    const rej = await t!.client.conversations.rejectDraft({ messageId: d2.id });
    await t!.queue.drain();
    expect(rej.status).toBe("needs_human");
    expect((await p.out()).length).toBe(n);
    await expect(t!.client.conversations.approveDraft({ messageId: d2.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("auto mode sends the answer directly, with the footer", async () => {
    const { p, bid } = await setup("auto");
    await p.say("4");
    await p.say("Comment renouveler mon titre de séjour ?");
    const last = await p.last();
    expect(last.endsWith(footer(t!, "en"))).toBe(true);
    expect(last.startsWith(waText("en", "chat_pending"))).toBe(false);
    const conv = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(conv.status).toBe("bot");
    expect(conv.pendingDrafts).toBe(0);
    expect(conv.messages.some((m) => m.author === "bot" && m.state === "sent" && m.sources.length > 0)).toBe(true);
  });

  it("legal questions get the handoff message and no answer on substance; the conversation needs a human", async () => {
    const { p, bid } = await setup("auto", "fr", "33620000003");
    await p.say("4");
    await p.say("j'ai besoin d'un avocat pour mon recours");
    const last = await p.last();
    expect(last).toBe(`${waText("fr", "chat_handoff")}\n\n${footer(t!, "fr")}`);
    const conv = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(conv.status).toBe("needs_human");
    expect(conv.messages.filter((m) => m.author === "bot")).toHaveLength(0);
    expect(conv.messages.find((m) => m.author === "beneficiary")!.intent).toBe("legal");
  });

  it("urgent messages get the fixed emergency text immediately (115) in any mode", async () => {
    const { p, bid } = await setup("review", "en", "33620000004");
    await p.say("4");
    await p.say("urgence je dois dormir dehors ce soir");
    expect(await p.last()).toContain("115");
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).status).toBe("needs_human");
  });

  it("a later question while an answer is pending still gets an acknowledgement (unless sent in the same burst)", async () => {
    const { p, bid } = await setup("review", "en", "33620000011");
    await p.say("4");
    await p.say("Comment renouveler mon titre de séjour ?");
    // the pending notice is older than 30 seconds: the next message is acknowledged again
    await t!.deps.db.update(messages).set({ createdAt: new Date(Date.now() - 5 * 60_000) }).where(and(eq(messages.beneficiaryId, bid), eq(messages.author, "system")));
    await p.say("Où est la préfecture ?");
    expect((await p.out()).filter((x) => x.startsWith(waText("en", "chat_pending"))).length).toBe(2);
  });

  it("'where is my letter?' while a letter is being checked says it is in progress", async () => {
    const { p } = await setup("review", "en", "33620000012");
    await p.say("1");
    await p.send(sampleFile("letters", "01-prefecture-convocation-titre-sejour.png"));
    await p.say("where is my letter?");
    expect(await p.last()).toContain(waText("en", "letter_received"));
  });

  it("emergency words get the 115 numbers even when the classifier sees a normal question", async () => {
    const { p, bid } = await setup("review", "en", "33620000013");
    await p.say("4");
    await p.say("I have nowhere to sleep, can you help with my CAF file?");
    const out = await p.out();
    expect(out.some((m) => m.includes("115"))).toBe(true);
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).status).toBe("needs_human");
  });

  it("taking over a conversation discards the bot's pending drafts", async () => {
    const { p, bid } = await setup("review", "en", "33620000014");
    await p.say("4");
    await p.say("Comment renouveler mon titre de séjour ?");
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).pendingDrafts).toBe(1);
    const conv = await t!.client.conversations.takeOver({ beneficiaryId: bid });
    expect(conv.pendingDrafts).toBe(0);
    expect(conv.messages.some((m) => m.state === "draft")).toBe(false);
  });

  it("letter and document intents redirect to the existing flows", async () => {
    const { p } = await setup("review", "en", "33620000005");
    await p.say("4");
    await p.say("I received a letter");
    expect(await p.last()).toContain(waText("en", "chat_letter_redirect"));
    await p.say("mes documents");
    expect(await p.last()).toContain(waText("en", "chat_document_redirect"));
  });

  it("a volunteer's French reply to an Arabic speaker is translated and carries the footer; resolve closes the handoff", async () => {
    const { p, bid } = await setup("review", "ar", "33620000006");
    await p.say("4");
    await p.say("أريد التحدث مع شخص"); // fake: no keyword match -> info... force a human request in French too
    await p.say("je veux parler à quelqu'un");
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).status).toBe("needs_human");

    const conv = await t!.client.conversations.reply({ beneficiaryId: bid, textFr: "Venez demain à 10h." });
    await t!.queue.drain();
    const msg = conv.messages.at(-1)!;
    expect(msg.author).toBe("volunteer");
    expect(msg.volunteerName).toBe("Test Volunteer");
    expect(msg.textFr).toBe("Venez demain à 10h.");
    expect(plain(msg.text)).toContain("[ar] Venez demain à 10h.");
    const last = await p.last();
    expect(plain(last)).toContain("[ar] Venez demain à 10h.");
    expect(last.endsWith(footer(t!, "ar"))).toBe(true);

    // resolving with an unreviewed draft keeps the conversation in the review queue; reject it first
    const draft = (await t!.client.conversations.get({ beneficiaryId: bid })).messages.find((m) => m.state === "draft");
    if (draft) await t!.client.conversations.rejectDraft({ messageId: draft.id });
    const closed = await t!.client.conversations.resolve({ beneficiaryId: bid });
    expect(closed.status).toBe("resolved");
    // a new beneficiary message reopens the conversation
    await p.say("شكرا");
    expect((await t!.client.conversations.get({ beneficiaryId: bid })).status).not.toBe("resolved");
  });

  it("voice notes get chat_voice_unsupported", async () => {
    const { processInbound } = await import("../src/conversation/engine.js");
    const { p } = await setup("review", "en", "33620000007");
    await processInbound(t!.wdeps, { id: "wamid.voice.1", from: "33620000007", timestamp: "1", type: "audio", audio: { id: "a1", mime_type: "audio/ogg", voice: true } } as never);
    await t!.queue.drain();
    expect(await p.last()).toBe(waText("en", "chat_voice_unsupported"));
  });

  it("the history sent to the LLM is plain text, bounded, and contains no phone number", async () => {
    const seen: ChatTurn[][] = [];
    const phone = "33620000008";
    t = await makeE2E({ config: { CHAT_MODE: "review", CHAT_HISTORY_TURNS: "3" } });
    const fake = new FakeProvider();
    const planChat = fake.planChat.bind(fake);
    fake.planChat = async (input) => {
      seen.push(input.history);
      return planChat(input);
    };
    (t.wdeps as { llm: unknown }).llm = fake;
    const p = t.phone(phone);
    await p.say("?");
    await p.say("2");
    await p.say("4");
    for (const q of ["Where is the prefecture?", "And the CAF?", "What about CPAM?", "Thanks"]) await p.say(q);
    expect(seen.length).toBe(4);
    for (const h of seen) {
      expect(h.length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(h)).not.toContain(phone);
      expect(h.every((x) => x.role === "beneficiary" || x.role === "assistant")).toBe(true);
    }
    expect(seen.at(-1)!.at(-1)).toEqual({ role: "beneficiary", text: "Thanks" });
  });

  it("translates the inbound message for volunteers while the intent is classified, not before", async () => {
    t = await makeE2E({ config: { CHAT_MODE: "review" } });
    const fake = new FakeProvider();
    const events: string[] = [];
    const planChat = fake.planChat.bind(fake);
    const translateText = fake.translateText.bind(fake);
    let releaseTranslation!: () => void;
    const translationGate = new Promise<void>((resolve) => (releaseTranslation = resolve));
    fake.planChat = async (input) => {
      events.push("plan");
      releaseTranslation(); // the translation can only finish once the plan has started: they overlap
      return planChat(input);
    };
    fake.translateText = async (input) => {
      if (input.to !== "fr") return translateText(input);
      events.push("translate:start");
      await translationGate;
      events.push("translate:end");
      return translateText(input);
    };
    (t.wdeps as { llm: unknown }).llm = fake;
    const p = t.phone("33620000009");
    await p.say("?");
    await p.say("2");
    await p.say("4");
    await p.say("Where is the prefecture?");
    expect(events).toEqual(["translate:start", "plan", "translate:end"]);
    const conv = await t.client.conversations.get({ beneficiaryId: await beneficiaryIdOf(t, "33620000009") });
    expect(conv.messages.find((m) => m.author === "beneficiary")!.textFr).toBe("[fr] Where is the prefecture?");
  });

  it("conversations list: needs_human first, then pending_review; attention filter; access is logged", async () => {
    t = await makeE2E({ config: { CHAT_MODE: "review" } });
    const mk = async (phone: string, text: string) => {
      const p = t!.phone(phone);
      await p.say("?");
      await p.say("2");
      await p.say("4");
      await p.say(text);
      return beneficiaryIdOf(t!, phone);
    };
    const pending = await mk("33620000011", "Where is the prefecture?");
    const human = await mk("33620000012", "I want to speak to a human");
    const bot = await mk("33620000013", "hello"); // smalltalk intent in fake -> draft, pending too
    await t.wdeps.db.update(beneficiaries).set({ chatStatus: "bot" }).where(eq(beneficiaries.id, bot));
    const attention = await t.client.conversations.list({ filter: "attention", limit: 10 });
    expect(attention.items.map((i) => i.beneficiaryId)).toEqual([human, pending]);
    expect(await t.client.conversations.attentionCount()).toEqual({ count: 2 });
    expect(attention.items[0]!.status).toBe("needs_human");
    expect(attention.items[0]!.beneficiaryLabel).not.toContain("33620000012");
    const all = await t.client.conversations.list({ filter: "all", limit: 10 });
    expect(all.items.map((i) => i.beneficiaryId).sort()).toEqual([bot, human, pending].sort());
    await t.client.conversations.get({ beneficiaryId: pending });
    const logged = await t.deps.db.select().from(accessLog).where(and(eq(accessLog.action, "conversations.view"), eq(accessLog.targetId, pending)));
    expect(logged.length).toBe(1);
  });

  it("RPC permissions: conversations.view reads, conversations.reply is needed to act", async () => {
    const { bid } = await setup("review", "en", "33620000020");
    const { volunteerPermissions } = await import("../src/db/schema.js");
    const v = await createVolunteer(t!.deps);
    await t!.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: "conversations.reply", granted: false });
    const { client } = makeClient(t!.deps);
    await client.auth.login({ email: v.email, password: v.password });
    await expect(client.conversations.list({ filter: "all", limit: 5 })).resolves.toBeDefined();
    await expect(client.conversations.resolve({ beneficiaryId: bid })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(client.conversations.reply({ beneficiaryId: bid, textFr: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const anon = makeClient(t!.deps).client;
    await expect(anon.conversations.list({ filter: "all", limit: 5 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await client.system.health()).chat).toBe("review");
  });
});

describe("AnthropicProvider chat methods", () => {
  const mock = (replies: string[]) => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        async create(p: unknown) {
          calls.push(p);
          return { stop_reason: "end_turn", content: [{ type: "text", text: replies.shift() ?? "" }] };
        },
      },
    };
    return { client: client as never, calls };
  };

  it("planChat validates, repairs once, and forces needsHuman for legal/urgent/human", async () => {
    const { AnthropicProvider } = await import("../src/llm/anthropic.js");
    const m = mock(["not json", '{"intent":"legal","frenchQuery":"recours oqtf","needsHuman":false}']);
    const llm = new AnthropicProvider({ model: "x", client: m.client });
    const r = await llm.planChat({ history: [{ role: "beneficiary", text: "puis-je faire appel ?" }], language: "en" });
    expect(r).toEqual({ intent: "legal", frenchQuery: "recours oqtf", needsHuman: true });
    expect(m.calls).toHaveLength(2);
  });

  it("chatReply keeps only known snippet ids and enforces the 900 char limit; translateText returns plain text", async () => {
    const { AnthropicProvider } = await import("../src/llm/anthropic.js");
    const ok = mock(['{"text":"Hello","textFr":"Bonjour","usedIds":["a","zzz"]}']);
    const llm = new AnthropicProvider({ model: "x", client: ok.client });
    const r = await llm.chatReply({
      history: [], language: "en", intent: "info", association: { name: "A", contact: "c" }, today: "2026-11-06",
      snippets: [{ id: "a", title: "T", text: "x", url: null }],
    });
    expect(r.usedIds).toEqual(["a"]);
    const long = mock([`{"text":"${"a".repeat(901)}","textFr":"b","usedIds":[]}`, `{"text":"${"a".repeat(901)}","textFr":"b","usedIds":[]}`]);
    await expect(new AnthropicProvider({ model: "x", client: long.client }).chatReply({
      history: [], language: "en", intent: "info", association: { name: "A", contact: "c" }, snippets: [], today: "2026-11-06",
    })).rejects.toThrow(/validation/);
    const tr = mock(["Bonjour"]);
    expect(await new AnthropicProvider({ model: "x", client: tr.client }).translateText({ text: "Hello", from: "en", to: "fr" })).toBe("Bonjour");
  });
});
