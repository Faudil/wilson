import { DomainError } from "../errors.js";
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
import { maskedLabel } from "../beneficiaries/serviceImpl.js";
import { beneficiaries, letters, messages, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { JOBS } from "../jobs/names.js";
import type { ChatTurn } from "../llm/provider.js";
import { getServices } from "../services.js";
import { footerFor, windowOpen } from "../whatsapp/send.js";
import { looksUrgent } from "./urgent.js";
import { localDate } from "../time.js";
import { withUsageContext } from "../usage/context.js";
import { getPlaces } from "../places/service.js";

type Row = typeof messages.$inferSelect;
type ChatStatus = (typeof beneficiaries.$inferSelect)["chatStatus"];
type Source = ChatMessage["sources"][number];
type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export class ChatError extends DomainError {
  constructor(code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST", message: string) {
    super(code, message);
    this.name = "ChatError";
  }
}

const RLM = "‏";

/** Wrap Latin/digit runs (addresses, phones, names of institutions) with FSI..PDI in RTL text, RLM at each line start. */
export function bidi(lang: LanguageCode, text: string): string {
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
  /** Volunteer writes in French; translated, footer appended. Takes an unassigned conversation over. */
  volunteerReply(beneficiaryId: string, volunteerId: string, textFr: string): Promise<void>;
  /** Menu "0": flag the conversation for volunteers and tell the person a volunteer will answer (unless already told). */
  requestHuman(beneficiaryId: string): Promise<void>;
  /** The bot goes silent; the beneficiary is told a volunteer answers personally (unless already told). */
  takeOver(beneficiaryId: string, volunteerId: string, opts?: { force?: boolean }): Promise<void>;
  /** Close the handoff and give the conversation back to the bot. */
  resolve(beneficiaryId: string, volunteerId: string): Promise<void>;
  /** `mine` = taken over by `volunteerId`. */
  list(input: { filter: "attention" | "mine" | "all"; cursor?: string; limit: number; volunteerId?: string }): Promise<{ items: ConversationSummary[]; nextCursor: string | null }>;
  get(beneficiaryId: string): Promise<ConversationDetail | null>;
  /** How many conversations `list({ filter: "attention" })` would return, without building them (navigation badge). */
  attentionCount(): Promise<number>;
  /** Conversations where a person must act (needs_human, or a volunteer's person writing) and nothing moved since `before`. */
  waitingCount(before: Date): Promise<number>;
}

const cache = new WeakMap<object, ChatService>();
/** One ChatService per deps object (needs deps.llm, so it is not part of getServices). */
export function getChat(deps: Deps): ChatService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createChatService(deps)));
  return s;
}

function createChatService(deps: Deps): ChatService {
  const { db, crypto, llm, config, jobs } = deps;
  const { beneficiaries: ben, knowledge } = getServices(deps);
  const association = { name: config.ASSOCIATION_NAME, contact: config.ASSOCIATION_CONTACT };
  const today = () => localDate(deps.now(), config.TIMEZONE);

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
    return (await getChatState(id)).status;
  }
  async function getChatState(id: string): Promise<{ status: ChatStatus; assigneeId: string | null }> {
    const [r] = await db.select({ s: beneficiaries.chatStatus, a: beneficiaries.chatAssigneeId }).from(beneficiaries).where(eq(beneficiaries.id, id)).limit(1);
    return { status: r?.s ?? "bot", assigneeId: r?.a ?? null };
  }
  async function assign(id: string, volunteerId: string | null, status: ChatStatus) {
    await db.update(beneficiaries).set({ chatStatus: status, chatAssigneeId: volunteerId }).where(eq(beneficiaries.id, id));
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

  /** Bot drafts left unanswered when a volunteer takes over: discarded, so nobody sends them by mistake. */
  async function discardDrafts(beneficiaryId: string) {
    await db.update(messages).set({ chatState: "rejected" }).where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.chatState, "draft")));
  }

  /** A letter of this person still being analysed or checked by a volunteer. */
  async function hasLetterInProgress(beneficiaryId: string): Promise<boolean> {
    const rows = await db.select({ id: letters.id }).from(letters)
      .where(and(eq(letters.beneficiaryId, beneficiaryId), inArray(letters.status, ["received", "analyzing", "pending_review", "approved"])))
      .limit(1);
    return rows.length > 0;
  }

  /** At most one "we received it, a volunteer checks" every 30 seconds, so a burst of messages sent together gets one answer. */
  // Compared with the database clock, like messages.created_at itself.
  async function ackedRecently(beneficiaryId: string): Promise<boolean> {
    const rows = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.direction, "out"), eq(messages.author, "system"), sql`${messages.createdAt} > now() - interval '30 seconds'`))
      .limit(1);
    return rows.length > 0;
  }

  /** French version of an inbound message for volunteers; null if the translation fails (the reply still goes out). */
  async function translateInbound(beneficiaryId: string, text: string, lang: LanguageCode): Promise<string | null> {
    try {
      return await withUsageContext(beneficiaryId, () => llm.translateText({ text, from: lang, to: "fr" }));
    } catch (e) {
      console.error("[chat] inbound translation failed:", e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function handleMessage(beneficiaryId: string, text: string, opts: { waMessageId?: string } = {}): Promise<void> {
    const b = await mustBeneficiary(beneficiaryId);
    const lang = b.language;
    const dek = await ben.getDek(beneficiaryId);

    // 1. store inbound (the engine already inserted the raw row: tag it, do not duplicate). The French version for
    // volunteers is translated while the intent is classified (step 2): the reply no longer waits for both in a row.
    const translating = lang === "fr" ? Promise.resolve(null) : translateInbound(beneficiaryId, text, lang);
    let inboundId: string;
    const existing = opts.waMessageId
      ? (await db.select({ id: messages.id }).from(messages).where(eq(messages.waMessageId, opts.waMessageId)).limit(1))[0]
      : undefined;
    if (existing) {
      await db.update(messages).set({ author: "beneficiary", chatState: "received" }).where(eq(messages.id, existing.id));
      inboundId = existing.id;
    } else {
      const [r] = await db.insert(messages).values({
        beneficiaryId, direction: "in", kind: "text", status: "received", bodyEnc: crypto.encrypt(dek, text),
        author: "beneficiary", chatState: "received",
      }).returning({ id: messages.id });
      inboundId = r!.id;
    }
    const status = await getStatus(beneficiaryId);
    if (status === "resolved") await setStatus(beneficiaryId, "bot");
    const withVolunteer = status === "with_volunteer";

    // 2. plan (in parallel with the translation)
    const turns = await history(beneficiaryId);
    const [planned, textFr] = await Promise.all([
      withUsageContext(beneficiaryId, () => llm.planChat({ history: turns, language: lang })).then(
        (p) => ({ ok: true as const, plan: p }),
        (e: unknown) => ({ ok: false as const, error: e }),
      ),
      translating,
    ]);
    const textFrEnc = textFr === null ? null : crypto.encrypt(dek, textFr);
    if (textFrEnc) await db.update(messages).set({ textFrEnc }).where(eq(messages.id, inboundId));
    if (!planned.ok) {
      const e = planned.error;
      console.error("[chat] planChat failed:", e instanceof Error ? e.message : String(e));
      if (!withVolunteer) await handoff(b, lang, "chat_handoff", "human");
      return;
    }
    const plan = planned.plan;
    await tag(inboundId, plan.intent);

    // Safety net: fixed emergency numbers on clear distress words, even if the classifier missed them. It only
    // adds the fixed message (no LLM text); the question is then handled as usual and flagged for a person.
    if (plan.intent !== "urgent" && looksUrgent(text, textFr)) {
      await sendFixed(beneficiaryId, lang, "chat_urgent", "urgent");
      if (!withVolunteer) await setStatus(beneficiaryId, "needs_human");
    }

    // A volunteer holds the conversation: the bot stays silent and the message waits for them. Only the fixed
    // emergency numbers still go out at once (safety net, no LLM text).
    if (withVolunteer) {
      if (plan.intent === "urgent") await sendFixed(beneficiaryId, lang, "chat_urgent", "urgent");
      return;
    }

    // Today's places posted by volunteers (shelter, food, showers…): sent at once, no review step, since the text is
    // the volunteers' own (only translated). French version kept for the Conversations screen.
    const sendPlaces = async (): Promise<boolean> => {
      const placesSvc = getPlaces(deps);
      const text = await placesSvc.messageFor(lang, { beneficiaryId });
      if (!text) return false;
      const textFr = lang === "fr" ? text : await placesSvc.messageFor("fr");
      await sendRow(beneficiaryId, lang, text, { author: "bot", intent: "places", textFr });
      return true;
    };

    // 3. route
    switch (plan.intent) {
      case "urgent":
        await handoff(b, lang, "chat_urgent", "urgent");
        // "Nowhere to sleep tonight": the emergency numbers first, then where volunteers know there is room.
        if (plan.needsPlaces) await sendPlaces();
        return;
      case "places":
        if (await sendPlaces()) {
          if (plan.needsHuman) await setStatus(beneficiaryId, "needs_human");
          return;
        }
        break; // nothing posted today: answer from the knowledge base (accueils de jour, 115, SIAO…) like any question
      case "human":
      case "legal": return handoff(b, lang, "chat_handoff", plan.intent);
      case "letter":
        // "Where is my letter?" while one is being checked: say it is in progress rather than "send a photo".
        await sendFixed(beneficiaryId, lang, (await hasLetterInProgress(beneficiaryId)) ? "letter_received" : "chat_letter_redirect", "letter");
        return;
      case "document":
        await sendFixed(beneficiaryId, lang, "chat_document_redirect", "document");
        return;
      default:
    }

    // info / smalltalk / out_of_scope / places with nothing posted: grounded answer
    const query = plan.frenchQuery || (plan.intent === "places" ? "hébergement d'urgence 115 accueil de jour repas douche" : text);
    const snippets = plan.intent === "info" || plan.intent === "smalltalk" || plan.intent === "places" ? await search(query) : [];
    let reply: { text: string; textFr: string; usedIds: string[] };
    try {
      reply = await withUsageContext(beneficiaryId, () => llm.chatReply({ history: turns, language: lang, intent: plan.intent, association, snippets: snippets.map(({ id, title, text: t, url }) => ({ id, title, text: t, url })), today: today() }));
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
    // Every message gets an answer: the first of a batch, and later ones unless we just acknowledged.
    if (firstOfBatch || !(await ackedRecently(beneficiaryId))) await sendFixed(beneficiaryId, lang, "chat_pending", null);
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
        const target = b.language === "fr" ? edited : await withUsageContext(m.beneficiaryId, () => llm.translateText({ text: edited, from: "fr", to: b.language }));
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
      // A rejected answer means the question still needs a person (unless a volunteer already holds it).
      if ((await getStatus(m.beneficiaryId)) !== "with_volunteer") await setStatus(m.beneficiaryId, "needs_human");
      return m.beneficiaryId;
    },

    async volunteerReply(beneficiaryId, volunteerId, textFr) {
      const b = await mustBeneficiary(beneficiaryId);
      const fr = textFr.trim();
      if (!fr) throw new ChatError("BAD_REQUEST", "empty reply");
      const target = b.language === "fr" ? fr : await withUsageContext(beneficiaryId, () => llm.translateText({ text: fr, from: "fr", to: b.language }));
      await sendRow(beneficiaryId, b.language, target, { author: "volunteer", textFr: fr, volunteerId });
      // Answering by hand = taking the conversation: the bot must not talk over the volunteer afterwards.
      const st = await getChatState(beneficiaryId);
      if (st.status !== "with_volunteer" || !st.assigneeId) {
        await assign(beneficiaryId, volunteerId, "with_volunteer");
        await discardDrafts(beneficiaryId);
      }
    },

    async requestHuman(beneficiaryId) {
      const b = await mustBeneficiary(beneficiaryId);
      const st = await getChatState(beneficiaryId);
      if (st.status === "with_volunteer" || st.status === "needs_human") return; // already with / waiting for a person
      await handoff(b, b.language, "chat_handoff", "human");
    },

    async takeOver(beneficiaryId, volunteerId, opts = {}) {
      const b = await mustBeneficiary(beneficiaryId);
      const st = await getChatState(beneficiaryId);
      if (st.status === "with_volunteer" && st.assigneeId === volunteerId) return;
      if (st.status === "with_volunteer" && st.assigneeId && !opts.force) throw new ChatError("CONFLICT", "assigned");
      await assign(beneficiaryId, volunteerId, "with_volunteer");
      await discardDrafts(beneficiaryId);
      // needs_human already sent chat_handoff ("a volunteer will answer you personally"); do not repeat it.
      if (st.status !== "needs_human" && st.status !== "with_volunteer") await sendFixed(beneficiaryId, b.language, "chat_handoff", null);
    },

    async resolve(beneficiaryId) {
      await mustBeneficiary(beneficiaryId);
      await assign(beneficiaryId, null, (await draftCount(beneficiaryId)) > 0 ? "pending_review" : "resolved");
    },

    async list({ filter, cursor, limit, volunteerId }) {
      const { rows, waiting, rank } = await ranked();
      const keep = (r: { id: string; status: ChatStatus; assigneeId: string | null }) =>
        filter === "all" ? true
        : filter === "mine" ? r.status === "with_volunteer" && r.assigneeId === volunteerId
        : rank(r) < 2;
      const filtered = rows.filter(keep)
        .map((r) => ({ ...r, last: r.last ? new Date(r.last) : null }))
        .sort((a, z) => rank(a) - rank(z) || (z.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
      const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
      const page = filtered.slice(start, start + limit);
      // One query each for the whole page (not three per conversation).
      const ids = page.map((r) => r.id);
      const [names, previews, awaitingOthers, nicknames] = await Promise.all([
        volunteerNames(page.flatMap((r) => (r.assigneeId ? [r.assigneeId] : []))),
        lastPreviews(ids),
        awaitingIds(page.filter((r) => r.status !== "with_volunteer").map((r) => r.id)),
        Promise.all(page.map((r) => ben.readNickname(r.id, r.nicknameEnc))),
      ]);
      const items = page.map((r, i): ConversationSummary => ({
        beneficiaryId: r.id, beneficiaryLabel: maskedLabel(r.last2), language: r.language, status: r.status,
        lastMessageAt: r.last ? r.last.toISOString() : null, lastPreview: previews.get(r.id) ?? null, pendingDrafts: r.drafts,
        assignee: r.assigneeId ? { id: r.assigneeId, name: names.get(r.assigneeId) ?? "?" } : null,
        awaitingReply: (r.status === "with_volunteer" ? waiting : awaitingOthers).has(r.id),
        nickname: nicknames[i] ?? null,
      }));
      return { items, nextCursor: start + limit < filtered.length ? String(start + limit) : null };
    },

    async waitingCount(before) {
      const { rows, rank } = await ranked();
      return rows.filter((r) => rank(r) === 0 && r.last !== null && new Date(r.last) < before).length;
    },

    async attentionCount() {
      const { rows, rank } = await ranked();
      return rows.filter((r) => rank(r) < 2).length;
    },

    async get(beneficiaryId) {
      const [b] = await db.select().from(beneficiaries).where(eq(beneficiaries.id, beneficiaryId)).limit(1);
      if (!b || b.archivedAt) return null;
      const dek = await ben.getDek(beneficiaryId);
      const rows = await db.select().from(messages).where(and(eq(messages.beneficiaryId, beneficiaryId), isNotNull(messages.author))).orderBy(asc(messages.createdAt), asc(messages.id));
      const names = await volunteerNames([...rows.flatMap((r) => (r.volunteerId ? [r.volunteerId] : [])), ...(b.chatAssigneeId ? [b.chatAssigneeId] : [])]);
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
        assignee: b.chatAssigneeId ? { id: b.chatAssigneeId, name: names.get(b.chatAssigneeId) ?? "?" } : null,
        awaitingReply: awaiting(msgs),
        nickname: await ben.readNickname(beneficiaryId, b.nicknameEnc),
        messages: msgs,
        footer: footerFor(deps, b.language),
        windowOpen: windowOpen(deps, b.lastInboundAt),
        guard: b.guardStatus as "none" | "quarantined" | "blocked",
      };
    },
  };

  /** Every open conversation with its attention rank: 0 = a person must act, 1 = drafts to review, 2 = nothing to do. */
  async function ranked() {
    const rows = await db.select({
      id: beneficiaries.id, language: beneficiaries.language, status: beneficiaries.chatStatus, assigneeId: beneficiaries.chatAssigneeId,
      last2: beneficiaries.waIdLast2, nicknameEnc: beneficiaries.nicknameEnc,
      last: sql<Date | null>`max(${messages.createdAt})`,
      drafts: sql<number>`count(*) filter (where ${messages.chatState} = 'draft')::int`,
    }).from(beneficiaries).innerJoin(messages, and(eq(messages.beneficiaryId, beneficiaries.id), isNotNull(messages.author)))
      .where(sql`${beneficiaries.archivedAt} is null`)
      .groupBy(beneficiaries.id);
    const waiting = await awaitingIds(rows.filter((r) => r.status === "with_volunteer").map((r) => r.id));
    // with_volunteer needs attention only while the beneficiary is waiting for an answer.
    const rank = (r: { id: string; status: ChatStatus }) =>
      r.status === "needs_human" ? 0 : r.status === "with_volunteer" ? (waiting.has(r.id) ? 0 : 2) : r.status === "pending_review" ? 1 : 2;
    return { rows, waiting, rank };
  }

  async function volunteerNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (unique.length) {
      for (const v of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, unique))) names.set(v.id, v.name);
    }
    return names;
  }

  /** Last chat message (ignoring drafts/rejected) is from the beneficiary = nobody answered yet. */
  function awaiting(msgs: Pick<ChatMessage, "author" | "state">[]): boolean {
    const last = [...msgs].reverse().find((m) => m.state === "received" || m.state === "sent");
    return last?.author === "beneficiary";
  }

  async function awaitingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    // Latest sent/received chat row per beneficiary; awaiting when it is the beneficiary's.
    const rows = await db.selectDistinctOn([messages.beneficiaryId], { id: messages.beneficiaryId, author: messages.author })
      .from(messages)
      .where(and(inArray(messages.beneficiaryId, ids), isNotNull(messages.author), inArray(messages.chatState, ["received", "sent"])))
      .orderBy(messages.beneficiaryId, desc(messages.createdAt), desc(messages.id));
    return new Set(rows.filter((r) => r.author === "beneficiary").map((r) => r.id));
  }

  /** Last message of each beneficiary (French version when there is one), for the conversation list. */
  async function lastPreviews(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (ids.length === 0) return out;
    const rows = await db.selectDistinctOn([messages.beneficiaryId], { id: messages.beneficiaryId, bodyEnc: messages.bodyEnc, textFrEnc: messages.textFrEnc })
      .from(messages)
      .where(and(inArray(messages.beneficiaryId, ids), eq(messages.author, "beneficiary")))
      .orderBy(messages.beneficiaryId, desc(messages.createdAt), desc(messages.id));
    for (const r of rows) {
      const dek = await ben.getDek(r.id);
      out.set(r.id, dec(dek, r.textFrEnc) ?? dec(dek, r.bodyEnc));
    }
    return out;
  }

}
