import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  isRtl,
  type ChatIntent,
  ConversationDetailSchema,
  ConversationSummarySchema,
  type ChatMessage,
  type LanguageCode,
} from "@wilson/contracts";
import { isolate, waText, type Params, type WaKey } from "@wilson/i18n";
import type { z } from "zod";
import { beneficiaries, messages, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { JOBS } from "../jobs/names.js";
import type { ChatTurn } from "../llm/provider.js";
import { getServices } from "../services.js";
import { footerFor } from "../whatsapp/send.js";
import { todayIn } from "../whatsapp/context.js";

type Row = typeof messages.$inferSelect;
type ChatStatus = (typeof beneficiaries.$inferSelect)["chatStatus"];
type Source = ChatMessage["sources"][number];
type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export class ChatError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST", message: string) {
    super(message);
    this.name = "ChatError";
  }
}

const RLM = "‏";

/** Wrap Latin/digit runs (addresses, phones, names of institutions) with FSI..PDI in RTL text, RLM at each line start. */
function bidi(lang: LanguageCode, text: string): string {
  if (!isRtl(lang)) return text;
  const isolated = text.replace(/[\p{Script=Latin}\d](?:[\p{Script=Latin}\d'’.\-/°]|(?:,\s?|\s)(?=[\p{Script=Latin}\d]))*/gu, (m) => isolate(m));
  return isolated.split("\n").map((l) => (l.length > 0 && !l.startsWith(RLM) ? RLM + l : l)).join("\n");
}

export interface ChatService {
  /** Entry point for free text from a beneficiary. `waMessageId`: the inbound row already stored by the engine. */
  handleMessage(beneficiaryId: string, text: string, opts?: { waMessageId?: string }): Promise<void>;
  /** Re-queue chat messages that were held behind the 24 h window (call on every inbound message). */
  flushQueued(beneficiaryId: string): Promise<void>;
  approveDraft(messageId: string, volunteerId: string, textFr?: string): Promise<string>;
  rejectDraft(messageId: string, volunteerId: string): Promise<string>;
  volunteerReply(beneficiaryId: string, volunteerId: string, textFr: string): Promise<void>;
  resolve(beneficiaryId: string, volunteerId: string): Promise<void>;
  list(input: { filter: "attention" | "all"; cursor?: string; limit: number }): Promise<{ items: ConversationSummary[]; nextCursor: string | null }>;
  get(beneficiaryId: string): Promise<ConversationDetail | null>;
}

const cache = new WeakMap<object, ChatService>();
/** One ChatService per deps object (needs deps.llm, so it is not part of getServices). */
export function getChat(deps: Deps): ChatService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createChatService(deps)));
  return s;
}

export function createChatService(deps: Deps): ChatService {
  const { db, crypto, llm, config, jobs } = deps;
  const { beneficiaries: ben, knowledge } = getServices(deps);
  const association = { name: config.ASSOCIATION_NAME, contact: config.ASSOCIATION_CONTACT };
  const today = () => todayIn(deps.now(), config.TIMEZONE);

  const dec = (dek: Buffer, b: Buffer | null): string | null => (b ? crypto.decrypt(dek, b).toString("utf8") : null);

  async function mustBeneficiary(id: string) {
    const b = await ben.get(id);
    if (!b) throw new ChatError("NOT_FOUND", "beneficiary not found");
    return b;
  }

  async function setStatus(id: string, status: ChatStatus) {
    await db.update(beneficiaries).set({ chatStatus: status }).where(eq(beneficiaries.id, id));
  }
  async function getStatus(id: string): Promise<ChatStatus> {
    const [r] = await db.select({ s: beneficiaries.chatStatus }).from(beneficiaries).where(eq(beneficiaries.id, id)).limit(1);
    return r?.s ?? "bot";
  }
  async function draftCount(id: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.beneficiaryId, id), eq(messages.chatState, "draft")));
    return r?.n ?? 0;
  }

  /** Text as the beneficiary receives it: bidi-safe body + the fixed footer. */
  const render = (lang: LanguageCode, body: string) => `${bidi(lang, body)}\n\n${footerFor(deps, lang)}`;

  /** Insert the outbound row (status queued) and enqueue the send. The wa.send worker flips it to sent. */
  async function sendRow(
    beneficiaryId: string,
    lang: LanguageCode,
    body: string,
    meta: { author: "bot" | "volunteer" | "system"; intent?: ChatIntent | null; textFr?: string | null; sources?: Source[]; volunteerId?: string | null },
  ): Promise<string> {
    const dek = await ben.getDek(beneficiaryId);
    const [row] = await db.insert(messages).values({
      beneficiaryId, direction: "out", kind: "text", status: "queued",
      bodyEnc: crypto.encrypt(dek, render(lang, body)),
      author: meta.author, chatState: "sent", intent: meta.intent ?? null,
      textFrEnc: meta.textFr ? crypto.encrypt(dek, meta.textFr) : null,
      sources: meta.sources ?? null, volunteerId: meta.volunteerId ?? null,
    }).returning({ id: messages.id });
    await jobs.send(JOBS.waSend, { kind: "chat", messageId: row!.id });
    return row!.id;
  }

  /** Fixed catalog text (no LLM). */
  const sendFixed = (beneficiaryId: string, lang: LanguageCode, key: WaKey, intent: ChatIntent | null) => {
    const params: Params = key === "chat_urgent" || key === "chat_handoff" ? { name: association.name, contact: association.contact } : {};
    return sendRow(beneficiaryId, lang, waText(lang, key, params), { author: "system", intent });
  };

  async function history(beneficiaryId: string): Promise<ChatTurn[]> {
    const rows = await db.select().from(messages)
      .where(and(eq(messages.beneficiaryId, beneficiaryId), inArray(messages.author, ["beneficiary", "bot", "volunteer"]), inArray(messages.chatState, ["received", "sent"])))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(Math.max(1, config.CHAT_HISTORY_TURNS));
    const dek = await ben.getDek(beneficiaryId);
    return rows.reverse().flatMap((r): ChatTurn[] => {
      // Beneficiary: what they wrote. Assistant: the French version (no footer, no bidi marks) when we have it.
      const text = r.author === "beneficiary" ? dec(dek, r.bodyEnc) : (dec(dek, r.textFrEnc) ?? dec(dek, r.bodyEnc));
      return text ? [{ role: r.author === "beneficiary" ? "beneficiary" : "assistant", text }] : [];
    });
  }

  async function search(query: string): Promise<Awaited<ReturnType<typeof knowledge.getChunks>>> {
    if (!config.RAG_ENABLED) return [];
    try {
      const department = config.KNOWLEDGE_DEPARTMENTS.split(",")[0]?.trim() || undefined;
      const [procedures, contacts] = await Promise.all([
        knowledge.search({ query, department, kinds: ["procedure"], limit: 4 }),
        knowledge.search({ query, department, kinds: ["contact"], limit: 3 }),
      ]);
      const ids = [...new Set([...procedures, ...contacts].map((h) => h.id))];
      return ids.length ? await knowledge.getChunks(ids) : [];
    } catch (e) {
      console.error("[chat] knowledge search failed:", e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  async function tag(rowId: string, intent: ChatIntent | null) {
    await db.update(messages).set({ intent }).where(eq(messages.id, rowId));
  }

  async function handoff(b: { id: string }, lang: LanguageCode, key: "chat_handoff" | "chat_urgent", intent: ChatIntent) {
    await setStatus(b.id, "needs_human");
    await sendFixed(b.id, lang, key, intent);
  }

  async function handleMessage(beneficiaryId: string, text: string, opts: { waMessageId?: string } = {}): Promise<void> {
    const b = await mustBeneficiary(beneficiaryId);
    const lang = b.language;
    const dek = await ben.getDek(beneficiaryId);

    // 1. store inbound (the engine already inserted the raw row: tag it, do not duplicate)
    let textFrEnc: Buffer | null = null;
    if (lang !== "fr") {
      try {
        textFrEnc = crypto.encrypt(dek, await llm.translateText({ text, from: lang, to: "fr" }));
      } catch (e) {
        console.error("[chat] inbound translation failed:", e instanceof Error ? e.message : String(e));
      }
    }
    let inboundId: string;
    const existing = opts.waMessageId
      ? (await db.select({ id: messages.id }).from(messages).where(eq(messages.waMessageId, opts.waMessageId)).limit(1))[0]
      : undefined;
    if (existing) {
      await db.update(messages).set({ author: "beneficiary", chatState: "received", textFrEnc }).where(eq(messages.id, existing.id));
      inboundId = existing.id;
    } else {
      const [r] = await db.insert(messages).values({
        beneficiaryId, direction: "in", kind: "text", status: "received", bodyEnc: crypto.encrypt(dek, text),
        author: "beneficiary", chatState: "received", textFrEnc,
      }).returning({ id: messages.id });
      inboundId = r!.id;
    }
    if ((await getStatus(beneficiaryId)) === "resolved") await setStatus(beneficiaryId, "bot");

    // 2. plan
    const turns = await history(beneficiaryId);
    let plan: { intent: ChatIntent; frenchQuery: string; needsHuman: boolean };
    try {
      plan = await llm.planChat({ history: turns, language: lang });
    } catch (e) {
      console.error("[chat] planChat failed:", e instanceof Error ? e.message : String(e));
      await handoff(b, lang, "chat_handoff", "human");
      return;
    }
    await tag(inboundId, plan.intent);

    // 3. route
    switch (plan.intent) {
      case "urgent": return handoff(b, lang, "chat_urgent", "urgent");
      case "human":
      case "legal": return handoff(b, lang, "chat_handoff", plan.intent);
      case "letter":
        await sendFixed(beneficiaryId, lang, "chat_letter_redirect", "letter");
        return;
      case "document":
        await sendFixed(beneficiaryId, lang, "chat_document_redirect", "document");
        return;
      default:
    }

    // info / smalltalk / out_of_scope: grounded answer
    const snippets = plan.intent === "info" || plan.intent === "smalltalk" ? await search(plan.frenchQuery || text) : [];
    let reply: { text: string; textFr: string; usedIds: string[] };
    try {
      reply = await llm.chatReply({ history: turns, language: lang, intent: plan.intent, association, snippets: snippets.map(({ id, title, text: t, url }) => ({ id, title, text: t, url })), today: today() });
    } catch (e) {
      console.error("[chat] chatReply failed:", e instanceof Error ? e.message : String(e));
      await handoff(b, lang, "chat_handoff", "human");
      return;
    }
    const sources: Source[] = reply.usedIds.flatMap((id) => snippets.filter((s) => s.id === id)).slice(0, 8)
      .map((c) => ({ chunkId: c.id, sourceId: c.sourceId, title: c.title, url: c.url }));

    if (config.CHAT_MODE === "auto") {
      await sendRow(beneficiaryId, lang, reply.text, { author: "bot", intent: plan.intent, textFr: reply.textFr, sources });
      if (plan.needsHuman) await setStatus(beneficiaryId, "needs_human");
      return;
    }

    // review: store the draft; tell the person once per pending batch
    const firstOfBatch = (await draftCount(beneficiaryId)) === 0;
    await db.insert(messages).values({
      beneficiaryId, direction: "out", kind: "text", status: "queued",
      bodyEnc: crypto.encrypt(dek, render(lang, reply.text)),
      author: "bot", chatState: "draft", intent: plan.intent,
      textFrEnc: crypto.encrypt(dek, reply.textFr), sources,
    });
    const current = await getStatus(beneficiaryId);
    if (plan.needsHuman || current === "needs_human") await setStatus(beneficiaryId, "needs_human");
    else await setStatus(beneficiaryId, "pending_review");
    if (firstOfBatch) await sendFixed(beneficiaryId, lang, "chat_pending", null);
  }

  async function mustDraft(messageId: string): Promise<Row> {
    const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!m) throw new ChatError("NOT_FOUND", "message not found");
    if (m.chatState !== "draft") throw new ChatError("CONFLICT", "this message is not a pending draft");
    return m;
  }

  /** After a draft left the queue: pending_review -> bot when nothing else is waiting. */
  async function settle(beneficiaryId: string) {
    if ((await getStatus(beneficiaryId)) === "pending_review" && (await draftCount(beneficiaryId)) === 0) await setStatus(beneficiaryId, "bot");
  }

  return {
    handleMessage,

    async flushQueued(beneficiaryId) {
      const rows = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.direction, "out"), eq(messages.status, "queued"), eq(messages.chatState, "sent"), isNotNull(messages.author)));
      for (const r of rows) await jobs.send(JOBS.waSend, { kind: "chat", messageId: r.id });
    },

    async approveDraft(messageId, volunteerId, textFr) {
      const m = await mustDraft(messageId);
      const b = await mustBeneficiary(m.beneficiaryId);
      const dek = await ben.getDek(m.beneficiaryId);
      // createdAt = the moment it is actually sent, so it sits after the "pending" notice in the thread.
      const patch: Partial<typeof messages.$inferInsert> = { chatState: "sent", volunteerId, createdAt: sql`now()` as unknown as Date };
      const edited = textFr?.trim();
      if (edited && edited !== (dec(dek, m.textFrEnc) ?? "")) {
        const target = b.language === "fr" ? edited : await llm.translateText({ text: edited, from: "fr", to: b.language });
        patch.bodyEnc = crypto.encrypt(dek, render(b.language, target));
        patch.textFrEnc = crypto.encrypt(dek, edited);
      }
      await db.update(messages).set(patch).where(eq(messages.id, messageId));
      await jobs.send(JOBS.waSend, { kind: "chat", messageId });
      await settle(m.beneficiaryId);
      return m.beneficiaryId;
    },

    async rejectDraft(messageId) {
      const m = await mustDraft(messageId);
      await db.update(messages).set({ chatState: "rejected" }).where(eq(messages.id, messageId));
      // A rejected answer means the question still needs a person.
      await setStatus(m.beneficiaryId, "needs_human");
      return m.beneficiaryId;
    },

    async volunteerReply(beneficiaryId, volunteerId, textFr) {
      const b = await mustBeneficiary(beneficiaryId);
      const fr = textFr.trim();
      if (!fr) throw new ChatError("BAD_REQUEST", "empty reply");
      const target = b.language === "fr" ? fr : await llm.translateText({ text: fr, from: "fr", to: b.language });
      await sendRow(beneficiaryId, b.language, target, { author: "volunteer", textFr: fr, volunteerId });
    },

    async resolve(beneficiaryId) {
      await mustBeneficiary(beneficiaryId);
      await setStatus(beneficiaryId, (await draftCount(beneficiaryId)) > 0 ? "pending_review" : "resolved");
    },

    async list({ filter, cursor, limit }) {
      const rows = await db.select({
        id: beneficiaries.id, language: beneficiaries.language, status: beneficiaries.chatStatus,
        last: sql<Date | null>`max(${messages.createdAt})`,
        drafts: sql<number>`count(*) filter (where ${messages.chatState} = 'draft')::int`,
      }).from(beneficiaries).innerJoin(messages, and(eq(messages.beneficiaryId, beneficiaries.id), isNotNull(messages.author)))
        .where(sql`${beneficiaries.archivedAt} is null`)
        .groupBy(beneficiaries.id);
      const rank = { needs_human: 0, pending_review: 1, bot: 2, resolved: 3 } as const;
      const filtered = rows.filter((r) => filter === "all" || r.status === "needs_human" || r.status === "pending_review")
        .map((r) => ({ ...r, last: r.last ? new Date(r.last) : null }))
        .sort((a, z) => Math.min(rank[a.status], 2) - Math.min(rank[z.status], 2) || (z.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
      const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
      const page = filtered.slice(start, start + limit);
      const items = await Promise.all(page.map(async (r): Promise<ConversationSummary> => ({
        beneficiaryId: r.id, beneficiaryLabel: await ben.label(r.id), language: r.language, status: r.status,
        lastMessageAt: r.last ? r.last.toISOString() : null, lastPreview: await lastPreview(r.id), pendingDrafts: r.drafts,
      })));
      return { items, nextCursor: start + limit < filtered.length ? String(start + limit) : null };
    },

    async get(beneficiaryId) {
      const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, beneficiaryId)).limit(1);
      if (!b || b.archivedAt) return null;
      const dek = await ben.getDek(beneficiaryId);
      const rows = await db.select().from(messages).where(and(eq(messages.beneficiaryId, beneficiaryId), isNotNull(messages.author))).orderBy(asc(messages.createdAt), asc(messages.id));
      const names = new Map<string, string>();
      const vids = [...new Set(rows.flatMap((r) => (r.volunteerId ? [r.volunteerId] : [])))];
      if (vids.length) {
        for (const v of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, vids))) names.set(v.id, v.name);
      }
      const msgs: ChatMessage[] = rows.map((r) => ({
        id: r.id,
        author: r.author!,
        text: dec(dek, r.bodyEnc) ?? "",
        textFr: dec(dek, r.textFrEnc),
        at: r.createdAt.toISOString(),
        state: r.chatState ?? "sent",
        intent: r.intent,
        sources: (r.sources ?? []) as Source[],
        volunteerName: r.volunteerId ? (names.get(r.volunteerId) ?? null) : null,
      }));
      const last = [...msgs].reverse().find((m) => m.author === "beneficiary");
      return {
        beneficiaryId, beneficiaryLabel: await ben.label(beneficiaryId), language: b.language, status: b.chatStatus,
        lastMessageAt: rows.at(-1)?.createdAt.toISOString() ?? null,
        lastPreview: last ? (last.textFr ?? last.text) : null,
        pendingDrafts: msgs.filter((m) => m.state === "draft").length,
        messages: msgs,
      };
    },
  };

  async function lastPreview(beneficiaryId: string): Promise<string | null> {
    const [r] = await db.select().from(messages).where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.author, "beneficiary"))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
    if (!r) return null;
    const dek = await ben.getDek(beneficiaryId);
    return dec(dek, r.textFrEnc) ?? dec(dek, r.bodyEnc);
  }
}
