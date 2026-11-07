import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { LanguageCode, LetterAnalysis, LetterDetail, LetterStatus, LetterSummary, LetterType } from "@wilson/contracts";
import type { LetterEditSchema } from "@wilson/contracts";
import { renderLetterReply, waText } from "@wilson/i18n";
import type { BeneficiariesService } from "../beneficiaries/service.js";
import { letterEvents, letters, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { JOBS } from "../jobs/names.js";
import type { KnowledgeService } from "../knowledge/types.js";
import { LlmError } from "../llm/provider.js";
import { buildRagQuery } from "./ragQuery.js";
import { footerFor, enqueueText } from "../whatsapp/send.js";
import { todayIn } from "../whatsapp/context.js";
import { withUsageContext } from "../usage/context.js";

export type LetterEdit = z.infer<typeof LetterEditSchema>;

export class LettersError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST", message: string) {
    super(message);
    this.name = "LettersError";
  }
}

export interface LetterOutgoing {
  letterId: string;
  beneficiaryId: string;
  status: LetterStatus;
  awaitingOptIn: boolean;
  /** First message: title, date, what to do, footer. Null if there is no analysis. */
  text: string | null;
  /** Sent on request ("3 - More explanation"): what the letter says, who can help, footer. */
  details: string | null;
}

export interface LettersService {
  /** Encrypt + store the photo, insert the letter, ack the sender, queue `letter.analyze`. */
  receivePhoto(input: { beneficiaryId: string; bytes: Buffer; mimeType: string }): Promise<{ letterId: string }>;
  /** Worker for `letter.analyze`. */
  analyzeLetter(letterId: string): Promise<void>;
  list(input: { cursor?: string; limit: number; status?: LetterStatus[] }): Promise<{ items: LetterSummary[]; nextCursor: string | null }>;
  get(id: string): Promise<LetterDetail | null>;
  readPhoto(id: string): Promise<{ bytes: Buffer; mimeType: string } | null>;
  edit(input: LetterEdit, volunteerId: string): Promise<LetterDetail>;
  approve(id: string, volunteerId: string): Promise<LetterDetail>;
  reject(id: string, volunteerId: string, note?: string): Promise<LetterDetail>;
  /** Delete the tmp photo now (beneficiary answered "no", or it was moved to My documents). Idempotent. */
  discardPhoto(id: string): Promise<void>;
  /** Photos of sent/rejected letters older than PHOTO_TTL_HOURS. Returns how many were deleted. */
  purgeExpiredPhotos(now: Date): Promise<number>;
  getOutgoing(id: string): Promise<LetterOutgoing | null>;
  setAwaitingOptIn(id: string, value: boolean): Promise<void>;
  /** wa.send delivered the reply: status sent, sentAt, event. */
  markSent(id: string): Promise<void>;
}

type LetterRow = typeof letters.$inferSelect;

export const ORIENTATION_WARNING = "Orientation non enrichie (base de connaissances indisponible)";

/**
 * `knowledge` is optional: when absent (or RAG_ENABLED=false) the orientation step is skipped and the analysis keeps
 * the orientation written by analyzeLetter.
 */
export function createLettersService(deps: Deps, beneficiaries: BeneficiariesService, knowledge?: KnowledgeService): LettersService {
  const { db, crypto, blobs, llm, config } = deps;
  const today = () => todayIn(deps.now(), config.TIMEZONE);
  const photoKeyOf = (id: string) => `tmp/letters/${id}`;

  async function row(id: string): Promise<LetterRow | null> {
    const [r] = await db.select().from(letters).where(eq(letters.id, id)).limit(1);
    return r ?? null;
  }
  async function mustRow(id: string): Promise<LetterRow> {
    const r = await row(id);
    if (!r) throw new LettersError("NOT_FOUND", "letter not found");
    return r;
  }
  async function event(letterId: string, action: (typeof letterEvents.$inferInsert)["action"], volunteerId: string | null = null, note: string | null = null) {
    await db.insert(letterEvents).values({ letterId, action, volunteerId, note });
  }
  async function readAnalysis(r: LetterRow): Promise<LetterAnalysis | null> {
    if (!r.analysisEnc) return null;
    const dek = await beneficiaries.getDek(r.beneficiaryId);
    return crypto.decryptJson<LetterAnalysis>(dek, r.analysisEnc);
  }
  async function encryptAnalysis(beneficiaryId: string, a: LetterAnalysis): Promise<Buffer> {
    return crypto.encryptJson(await beneficiaries.getDek(beneficiaryId), a);
  }
  const association = { name: config.ASSOCIATION_NAME, contact: config.ASSOCIATION_CONTACT };

  /** RAG orientation. Never throws: on any failure the letter keeps its original orientation + a reviewer warning. */
  async function enrichOrientation(letterId: string, a: LetterAnalysis, language: LanguageCode): Promise<number | null> {
    if (!knowledge || !config.RAG_ENABLED) return null;
    try {
      const department = config.KNOWLEDGE_DEPARTMENTS.split(",")[0]?.trim() || undefined;
      const query = buildRagQuery(a);
      const [procedures, contacts] = await Promise.all([
        knowledge.search({ query, department, kinds: ["procedure"], limit: 4 }),
        knowledge.search({ query, department, kinds: ["contact"], limit: 4 }),
      ]);
      const ids = [...new Set([...contacts, ...procedures].map((h) => h.id))];
      const chunks = ids.length ? await knowledge.getChunks(ids) : [];
      if (!chunks.length) return 0;
      const out = await llm.orientLetter({
        analysis: a,
        targetLanguage: language,
        association,
        snippets: chunks.map((c) => ({ id: c.id, title: c.title, text: c.text, url: c.url })),
      });
      const used = out.usedIds.flatMap((id) => chunks.filter((c) => c.id === id));
      a.fr = { ...a.fr, orientation: out.fr };
      a.target = { ...a.target, orientation: out.target };
      a.sources = used.slice(0, 8).map((c) => ({ chunkId: c.id, sourceId: c.sourceId, title: c.title, url: c.url }));
      return a.sources.length;
    } catch (e) {
      console.error(`[letters] orientation step failed for ${letterId}: ${e instanceof Error ? e.message : String(e)}`);
      if (!a.reviewerWarnings.includes(ORIENTATION_WARNING)) a.reviewerWarnings = [...a.reviewerWarnings, ORIENTATION_WARNING];
      return null;
    }
  }
  const render = (lang: LanguageCode, a: LetterAnalysis, which: "fr" | "target", part: "short" | "details" = "short") =>
    renderLetterReply({ lang, text: a[which], deadline: a.deadline, urgency: a.urgency, today: today(), association, part });

  async function toSummary(r: LetterRow): Promise<LetterSummary> {
    const b = await beneficiaries.get(r.beneficiaryId);
    return {
      id: r.id,
      beneficiaryId: r.beneficiaryId,
      beneficiaryLabel: await beneficiaries.label(r.beneficiaryId),
      language: b?.language ?? "fr",
      status: r.status as LetterStatus,
      letterType: (r.letterType as LetterType | null) ?? null,
      urgency: (r.urgency as LetterSummary["urgency"]) ?? null,
      deadline: r.deadline ?? null,
      lowConfidence: r.lowConfidence,
      receivedAt: r.receivedAt.toISOString(),
    };
  }

  async function toDetail(r: LetterRow): Promise<LetterDetail> {
    const summary = await toSummary(r);
    const analysis = await readAnalysis(r);
    const events = await db
      .select({ at: letterEvents.at, action: letterEvents.action, note: letterEvents.note, name: volunteers.name })
      .from(letterEvents)
      .leftJoin(volunteers, eq(volunteers.id, letterEvents.volunteerId))
      .where(eq(letterEvents.letterId, r.id))
      .orderBy(asc(letterEvents.at));
    return {
      ...summary,
      analysis,
      outgoingText: analysis ? render(summary.language, analysis, "target") : null,
      outgoingTextFr: analysis ? render("fr", analysis, "fr") : null,
      outgoingDetailsText: analysis ? render(summary.language, analysis, "target", "details") : null,
      outgoingDetailsTextFr: analysis ? render("fr", analysis, "fr", "details") : null,
      hasPhoto: r.photoKey !== null,
      frEdited: r.frEdited,
      history: events.map((e) => ({ at: e.at.toISOString(), volunteerName: e.name ?? null, action: e.action, note: e.note })),
    };
  }

  const svc: LettersService = {
    async receivePhoto({ beneficiaryId, bytes, mimeType }) {
      const b = await beneficiaries.get(beneficiaryId);
      if (!b) throw new LettersError("NOT_FOUND", "beneficiary not found");
      const id = randomUUID();
      const dek = await beneficiaries.getDek(beneficiaryId);
      const key = photoKeyOf(id);
      await blobs.put(key, crypto.encrypt(dek, bytes), "application/octet-stream");
      await db.insert(letters).values({ id, beneficiaryId, status: "received", photoKey: key, photoMime: mimeType, receivedAt: deps.now() });
      await enqueueText(deps, beneficiaryId, waText(b.language, "letter_received"));
      await deps.jobs.send(JOBS.letterAnalyze, { letterId: id }, { singletonKey: id });
      return { letterId: id };
    },

    async analyzeLetter(letterId) {
      const r = await row(letterId);
      if (!r || !["received", "analyzing"].includes(r.status)) return; // idempotent
      await db.update(letters).set({ status: "analyzing" }).where(eq(letters.id, letterId));
      const b = await beneficiaries.get(r.beneficiaryId);
      if (!b) return;
      const fail = async (note: string) => {
        await db.update(letters).set({ status: "failed" }).where(eq(letters.id, letterId));
        await event(letterId, "failed", null, note);
      };
      if (!r.photoKey) return fail("photo missing");
      let analysis: LetterAnalysis;
      try {
        const dek = await beneficiaries.getDek(r.beneficiaryId);
        const bytes = crypto.decrypt(dek, await blobs.get(r.photoKey));
        analysis = await withUsageContext(r.beneficiaryId, () => llm.analyzeLetter({ file: { bytes, mimeType: r.photoMime ?? "image/jpeg" }, targetLanguage: b.language, today: today() }));
      } catch (e) {
        if (e instanceof LlmError) return fail(e.message.slice(0, 300));
        throw e; // transient (storage, network): let the queue retry
      }
      const nSources = await withUsageContext(r.beneficiaryId, () => enrichOrientation(letterId, analysis, b.language));
      await db.update(letters).set({
        analysisEnc: await encryptAnalysis(r.beneficiaryId, analysis),
        letterType: analysis.letterType,
        urgency: analysis.urgency,
        deadline: analysis.deadline?.date ?? null,
        lowConfidence: analysis.confidence < 0.6,
        status: "pending_review",
      }).where(eq(letters.id, letterId));
      await event(letterId, "analyzed", null, nSources !== null ? `orientation enrichie: ${nSources} sources` : null);
    },

    async list({ cursor, limit, status }) {
      const offset = cursor ? Math.max(0, Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10) || 0) : 0;
      const where: SQL | undefined = status?.length ? inArray(letters.status, status) : undefined;
      const rows = await db
        .select()
        .from(letters)
        .where(where)
        .orderBy(
          sql`case ${letters.status} when 'pending_review' then 0 when 'failed' then 1 else 2 end`,
          sql`case ${letters.urgency} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`,
          sql`${letters.deadline} asc nulls last`,
          asc(letters.receivedAt),
        )
        .limit(limit + 1)
        .offset(offset);
      const page = rows.slice(0, limit);
      return {
        items: await Promise.all(page.map(toSummary)),
        nextCursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
      };
    },

    async get(id) {
      const r = await row(id);
      return r ? toDetail(r) : null;
    },

    async readPhoto(id) {
      const r = await row(id);
      if (!r?.photoKey) return null;
      const dek = await beneficiaries.getDek(r.beneficiaryId);
      return { bytes: crypto.decrypt(dek, await blobs.get(r.photoKey)), mimeType: r.photoMime ?? "image/jpeg" };
    },

    async edit(input, volunteerId) {
      const r = await mustRow(input.id);
      if (r.status !== "pending_review") throw new LettersError("CONFLICT", "letter is not pending review");
      const a = await readAnalysis(r);
      if (!a) throw new LettersError("CONFLICT", "letter has no analysis");
      const changed: string[] = [];
      const set: Partial<typeof letters.$inferInsert> = {};
      if (input.letterType !== undefined && input.letterType !== a.letterType) {
        a.letterType = input.letterType; set.letterType = input.letterType; changed.push("letterType");
      }
      if (input.urgency !== undefined && input.urgency !== a.urgency) {
        a.urgency = input.urgency; set.urgency = input.urgency; changed.push("urgency");
      }
      if (input.deadline !== undefined && JSON.stringify(input.deadline) !== JSON.stringify(a.deadline)) {
        a.deadline = input.deadline; set.deadline = input.deadline?.date ?? null; changed.push("deadline");
      }
      let frEdited = r.frEdited;
      if (input.fr !== undefined && JSON.stringify(input.fr) !== JSON.stringify(a.fr)) {
        a.fr = input.fr; changed.push("fr");
        frEdited = true;
      }
      if (input.target !== undefined && JSON.stringify(input.target) !== JSON.stringify(a.target)) {
        a.target = input.target; changed.push("target");
        // A hand-written translation wins over a pending automatic one, unless fr changed in the same edit.
        if (!changed.includes("fr")) frEdited = false;
      }
      if (changed.length) {
        await db.update(letters).set({ ...set, frEdited, analysisEnc: await encryptAnalysis(r.beneficiaryId, a) }).where(eq(letters.id, r.id));
        await event(r.id, "edited", volunteerId, changed.join(", "));
      }
      return toDetail(await mustRow(r.id));
    },

    async approve(id, volunteerId) {
      const r = await mustRow(id);
      if (r.status !== "pending_review") throw new LettersError("CONFLICT", "letter is not pending review");
      const a = await readAnalysis(r);
      if (!a) throw new LettersError("CONFLICT", "letter has no analysis");
      const b = await beneficiaries.get(r.beneficiaryId);
      if (!b) throw new LettersError("NOT_FOUND", "beneficiary not found");
      let analysisEnc: Buffer | undefined;
      if (r.frEdited) {
        // LlmError propagates: the volunteer sees the failure and can retry or edit `target` by hand.
        a.target = await withUsageContext(r.beneficiaryId, () => llm.translateLetterText({ fr: a.fr, targetLanguage: b.language }));
        analysisEnc = await encryptAnalysis(r.beneficiaryId, a);
        await event(id, "retranslated", volunteerId);
      }
      const claimed = await db.update(letters).set({
        status: "approved", reviewedBy: volunteerId, reviewedAt: deps.now(), frEdited: false, ...(analysisEnc ? { analysisEnc } : {}),
      }).where(and(eq(letters.id, id), eq(letters.status, "pending_review"))).returning({ id: letters.id });
      if (!claimed.length) throw new LettersError("CONFLICT", "letter is not pending review");
      await event(id, "approved", volunteerId);
      await deps.jobs.send(JOBS.waSend, { kind: "letter_reply", letterId: id });
      return toDetail(await mustRow(id));
    },

    async reject(id, volunteerId, note) {
      const r = await mustRow(id);
      if (r.status !== "pending_review" && r.status !== "failed") throw new LettersError("CONFLICT", "letter cannot be rejected");
      const b = await beneficiaries.get(r.beneficiaryId);
      if (!b) throw new LettersError("NOT_FOUND", "beneficiary not found");
      const claimed = await db.update(letters).set({ status: "rejected", reviewedBy: volunteerId, reviewedAt: deps.now() })
        .where(and(eq(letters.id, id), inArray(letters.status, ["pending_review", "failed"]))).returning({ id: letters.id });
      if (!claimed.length) throw new LettersError("CONFLICT", "letter cannot be rejected");
      await event(id, "rejected", volunteerId, note ?? null);
      const body = `${waText(b.language, "letter_rejected")}\n\n${footerFor(deps, b.language)}`;
      await enqueueText(deps, r.beneficiaryId, body, { letterId: id });
      return toDetail(await mustRow(id));
    },

    async discardPhoto(id) {
      const r = await row(id);
      if (!r?.photoKey) return;
      await blobs.delete(r.photoKey).catch(() => undefined);
      await db.update(letters).set({ photoKey: null }).where(eq(letters.id, id));
    },

    async purgeExpiredPhotos(now) {
      const cutoff = new Date(now.getTime() - config.PHOTO_TTL_HOURS * 3600 * 1000);
      const stale = await db.select({ id: letters.id }).from(letters).where(and(
        isNotNull(letters.photoKey),
        inArray(letters.status, ["sent", "rejected"]),
        lt(sql`coalesce(${letters.sentAt}, ${letters.reviewedAt}, ${letters.receivedAt})`, cutoff),
      ));
      for (const { id } of stale) await svc.discardPhoto(id);
      return stale.length;
    },

    async getOutgoing(id) {
      const r = await row(id);
      if (!r) return null;
      const a = await readAnalysis(r);
      const b = await beneficiaries.get(r.beneficiaryId);
      return {
        letterId: id,
        beneficiaryId: r.beneficiaryId,
        status: r.status as LetterStatus,
        awaitingOptIn: r.awaitingOptIn,
        text: a && b ? render(b.language, a, "target") : null,
        details: a && b ? render(b.language, a, "target", "details") : null,
      };
    },

    async setAwaitingOptIn(id, value) {
      await db.update(letters).set({ awaitingOptIn: value }).where(eq(letters.id, id));
    },

    async markSent(id) {
      const done = await db.update(letters).set({ status: "sent", sentAt: deps.now(), awaitingOptIn: false })
        .where(and(eq(letters.id, id), eq(letters.status, "approved"))).returning({ id: letters.id });
      if (done.length) await event(id, "sent");
    },
  };
  return svc;
}
