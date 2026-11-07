import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Broadcast, BroadcastEstimate, BroadcastInput, LanguageCode } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { bidi } from "../chat/service.js";
import { beneficiaries, broadcastRecipients, broadcasts, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { JOBS } from "../jobs/names.js";
import { withUsageContext } from "../usage/context.js";
import { footerFor, windowOpen } from "../whatsapp/send.js";

type Row = typeof broadcasts.$inferSelect;
type BDeps = Pick<Deps, "db" | "llm" | "config" | "now" | "jobs" | "wa">;

export class BroadcastError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN", readonly reason?: string) {
    super(reason ?? code);
    this.name = "BroadcastError";
  }
}

export interface BroadcastsService {
  list(): Promise<Broadcast[]>;
  get(id: string): Promise<Broadcast>;
  estimate(languages: LanguageCode[] | null): Promise<BroadcastEstimate>;
  create(input: BroadcastInput, volunteerId: string): Promise<Broadcast>;
  /** `asApprover`: the caller has broadcasts.approve (may edit or cancel someone else's draft). */
  update(id: string, input: BroadcastInput, volunteerId: string, asApprover: boolean): Promise<Broadcast>;
  cancel(id: string, volunteerId: string, asApprover: boolean): Promise<Broadcast>;
  approve(id: string, volunteerId: string): Promise<Broadcast>;
  /** The text a person with `lang` receives (translation cached on the row). */
  render(id: string, lang: LanguageCode): Promise<string>;
  /** Worker: translations, recipient rows, one wa.send per person. Idempotent. */
  dispatch(id: string): Promise<void>;
  /** Inbound message from a person: queue the announcements held behind the template. Returns how many. */
  releaseFor(beneficiaryId: string): Promise<number>;
  setOptIn(beneficiaryId: string, on: boolean): Promise<void>;
}

const cache = new WeakMap<object, BroadcastsService>();
export function getBroadcasts(deps: BDeps): BroadcastsService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createBroadcastsService(deps)));
  return s;
}

export function createBroadcastsService(deps: BDeps): BroadcastsService {
  const { db, llm, config, jobs } = deps;

  async function mustRow(id: string): Promise<Row> {
    const [r] = await db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1);
    if (!r) throw new BroadcastError("NOT_FOUND");
    return r;
  }

  /** Everyone who said yes to announcements, still active, in the chosen languages. */
  async function audience(languages: LanguageCode[] | null) {
    return db.select({ id: beneficiaries.id, language: beneficiaries.language, lastInboundAt: beneficiaries.lastInboundAt })
      .from(beneficiaries)
      .where(and(
        isNotNull(beneficiaries.announcementsOptInAt), isNull(beneficiaries.archivedAt),
        languages ? inArray(beneficiaries.language, languages) : undefined,
      ));
  }

  async function estimate(languages: LanguageCode[] | null): Promise<BroadcastEstimate> {
    const people = await audience(languages);
    const counts = new Map<LanguageCode, number>();
    let inWindow = 0;
    for (const p of people) {
      counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
      if (windowOpen(deps, p.lastInboundAt)) inWindow++;
    }
    const outsideWindow = people.length - inWindow;
    const byLanguage = [...counts].map(([language, count]) => ({ language, count })).sort((a, z) => z.count - a.count);
    return {
      recipients: people.length, byLanguage, inWindow, outsideWindow,
      whatsappCostCents: Math.round(outsideWindow * config.WHATSAPP_PRICE_MARKETING_USD * 100 * 100) / 100,
      translations: byLanguage.filter((l) => l.language !== "fr").length,
    };
  }

  async function names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    const m = new Map<string, string>();
    if (unique.length) for (const v of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, unique))) m.set(v.id, v.name);
    return m;
  }

  async function stats(ids: string[]) {
    const out = new Map<string, Broadcast["stats"]>();
    if (!ids.length) return out;
    const rows = await db.select({ id: broadcastRecipients.broadcastId, status: broadcastRecipients.status, n: sql<number>`count(*)::int` })
      .from(broadcastRecipients).where(inArray(broadcastRecipients.broadcastId, ids))
      .groupBy(broadcastRecipients.broadcastId, broadcastRecipients.status);
    for (const r of rows) {
      const s = out.get(r.id) ?? { total: 0, sent: 0, awaitingReply: 0, failed: 0, skipped: 0 };
      s.total += r.n;
      if (r.status === "sent") s.sent += r.n;
      else if (r.status === "awaiting_reply") s.awaitingReply += r.n;
      else if (r.status === "failed") s.failed += r.n;
      else if (r.status === "skipped") s.skipped += r.n;
      out.set(r.id, s);
    }
    return out;
  }

  async function toBroadcasts(rows: Row[]): Promise<Broadcast[]> {
    const [n, st] = await Promise.all([names(rows.flatMap((r) => [r.createdBy, r.approvedBy])), stats(rows.map((r) => r.id))]);
    return Promise.all(rows.map(async (r) => ({
      id: r.id, textFr: r.textFr, languages: r.languages, status: r.status as Broadcast["status"],
      createdAt: r.createdAt.toISOString(), createdById: r.createdBy, createdByName: r.createdBy ? (n.get(r.createdBy) ?? null) : null,
      approvedAt: r.approvedAt?.toISOString() ?? null, approvedByName: r.approvedBy ? (n.get(r.approvedBy) ?? null) : null,
      estimate: r.status === "draft" || !r.estimate ? await estimate(r.languages) : r.estimate,
      stats: st.get(r.id) ?? { total: 0, sent: 0, awaitingReply: 0, failed: 0, skipped: 0 },
    })));
  }
  const one = async (id: string) => (await toBroadcasts([await mustRow(id)]))[0]!;

  /** Author, or someone with broadcasts.approve. Drafts only. */
  function editable(r: Row, volunteerId: string, asApprover: boolean) {
    if (r.status !== "draft") throw new BroadcastError("CONFLICT", "not_draft");
    if (r.createdBy !== volunteerId && !asApprover) throw new BroadcastError("FORBIDDEN");
  }

  async function translated(r: Row, lang: LanguageCode): Promise<string> {
    if (lang === "fr") return r.textFr;
    const cached = r.translations[lang];
    if (cached) return cached;
    const text = (await withUsageContext(null, () => llm.translateText({ text: r.textFr, from: "fr", to: lang }))).trim();
    await db.update(broadcasts).set({ translations: sql`${broadcasts.translations} || ${JSON.stringify({ [lang]: text })}::jsonb` }).where(eq(broadcasts.id, r.id));
    r.translations = { ...r.translations, [lang]: text };
    return text;
  }

  /** Header, translated text, how to stop, the fixed footer. */
  const compose = (lang: LanguageCode, body: string) =>
    `${bidi(lang, `📣 *${config.ASSOCIATION_NAME}*\n${body}`)}\n\n${waText(lang, "broadcast_stop_hint")}\n\n${footerFor(deps, lang)}`;

  return {
    async list() {
      return toBroadcasts(await db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(100));
    },
    get: one,
    estimate,

    async create(input, volunteerId) {
      const [r] = await db.insert(broadcasts).values({ textFr: input.textFr, languages: input.languages, createdBy: volunteerId }).returning();
      return one(r!.id);
    },

    async update(id, input, volunteerId, asApprover) {
      editable(await mustRow(id), volunteerId, asApprover);
      await db.update(broadcasts).set({ textFr: input.textFr, languages: input.languages, translations: {}, updatedAt: deps.now() }).where(eq(broadcasts.id, id));
      return one(id);
    },

    async cancel(id, volunteerId, asApprover) {
      editable(await mustRow(id), volunteerId, asApprover);
      await db.update(broadcasts).set({ status: "cancelled", cancelledAt: deps.now() }).where(eq(broadcasts.id, id));
      return one(id);
    },

    async approve(id, volunteerId) {
      const r = await mustRow(id);
      if (r.status !== "draft") throw new BroadcastError("CONFLICT", "not_draft");
      if (config.BROADCAST_FOUR_EYES && r.createdBy === volunteerId) throw new BroadcastError("CONFLICT", "own_broadcast");
      const est = await estimate(r.languages);
      if (est.recipients === 0) throw new BroadcastError("CONFLICT", "no_recipients");
      // Only one approval wins (status checked in the update itself).
      const done = await db.update(broadcasts).set({ status: "sending", approvedBy: volunteerId, approvedAt: deps.now(), estimate: est })
        .where(and(eq(broadcasts.id, id), eq(broadcasts.status, "draft"))).returning({ id: broadcasts.id });
      if (!done.length) throw new BroadcastError("CONFLICT", "not_draft");
      await jobs.send(JOBS.broadcastDispatch, { broadcastId: id });
      return one(id);
    },

    async render(id, lang) {
      return compose(lang, await translated(await mustRow(id), lang));
    },

    async dispatch(id) {
      const r = await mustRow(id);
      if (r.status !== "sending") return;
      const people = await audience(r.languages);
      // Translate every language first (throws -> the job is retried before anyone gets anything).
      for (const lang of new Set(people.map((p) => p.language))) await translated(r, lang);
      if (people.length) {
        await db.insert(broadcastRecipients).values(people.map((p) => ({ broadcastId: id, beneficiaryId: p.id }))).onConflictDoNothing();
      }
      const queued = await db.select({ b: broadcastRecipients.beneficiaryId }).from(broadcastRecipients)
        .where(and(eq(broadcastRecipients.broadcastId, id), eq(broadcastRecipients.status, "queued")));
      for (const q of queued) await jobs.send(JOBS.waSend, { kind: "broadcast", broadcastId: id, beneficiaryId: q.b }, { singletonKey: `broadcast:${id}:${q.b}` });
      await db.update(broadcasts).set({ status: "sent", sentAt: deps.now() }).where(eq(broadcasts.id, id));
    },

    async releaseFor(beneficiaryId) {
      const rows = await db.select({ id: broadcastRecipients.broadcastId }).from(broadcastRecipients)
        .where(and(eq(broadcastRecipients.beneficiaryId, beneficiaryId), eq(broadcastRecipients.status, "awaiting_reply")));
      for (const r of rows) await jobs.send(JOBS.waSend, { kind: "broadcast", broadcastId: r.id, beneficiaryId });
      return rows.length;
    },

    async setOptIn(beneficiaryId, on) {
      await db.update(beneficiaries).set({ announcementsOptInAt: on ? deps.now() : null }).where(eq(beneficiaries.id, beneficiaryId));
      if (!on) {
        // Saying stop also drops what is still waiting for them.
        await db.update(broadcastRecipients).set({ status: "skipped" })
          .where(and(eq(broadcastRecipients.beneficiaryId, beneficiaryId), inArray(broadcastRecipients.status, ["queued", "awaiting_reply"])));
      }
    },
  };
}
