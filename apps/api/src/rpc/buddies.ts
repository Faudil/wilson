import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BuddyMatch, BuddyMatchDetail, BuddyMode, BuddyReport, BuddyRequest, BuddySlot, Permission, Volunteer } from "@wilson/contracts";
import { isBsuid } from "@wilson/contracts";
import { maskedLabel } from "../beneficiaries/serviceImpl.js";
import { getBuddies, OPEN_MATCH, type MatchRow } from "../buddies/service.js";
import { beneficiaries, buddyMatches, buddyMessages, buddyProfiles, buddyReports, buddyRequests, buddySessions, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { getServices } from "../services.js";
import { getWaDeps } from "../whatsapp/context.js";
import { logAccess } from "./logAccess.js";
import { can, guard, os, requireAny, requirePermission, type RpcContext } from "./base.js";

/**
 * French practice buddies. Three permissions, checked here on every call (the UI only hides buttons):
 * - buddies.be_buddy: own profile, open requests without identity, propose oneself, act on one's OWN pairings only;
 * - buddies.manage: every request and pairing, candidates, propose anyone, end any pairing; never the messages or numbers;
 * - buddies.reports: reports, and the messages of a pairing that has been reported (logged), resume or end it.
 */
const BE = "buddies.be_buddy" satisfies Permission;
const MANAGE = "buddies.manage" satisfies Permission;
const REPORTS = "buddies.reports" satisfies Permission;

const svc = () => getBuddies(getWaDeps());

async function matchRow(deps: Deps, id: string): Promise<MatchRow> {
  const [m] = await deps.db.select().from(buddyMatches).where(eq(buddyMatches.id, id)).limit(1);
  if (!m) throw new ORPCError("NOT_FOUND");
  return m;
}

/** Own pairing: the caller is its volunteer AND still holds buddies.be_buddy. Anything else is FORBIDDEN. */
async function ownMatch(ctx: RpcContext & { volunteer: Volunteer }, id: string): Promise<MatchRow> {
  const m = await matchRow(ctx.deps, id);
  if (!can(ctx.volunteer, BE) || m.volunteerId !== ctx.volunteer.id) throw new ORPCError("FORBIDDEN");
  return m;
}

async function toMatches(deps: Deps, rows: MatchRow[]): Promise<BuddyMatch[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const vols = new Map((await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers)
    .where(inArray(volunteers.id, [...new Set(rows.map((r) => r.volunteerId))]))).map((v) => [v.id, v.name]));
  const bens = new Map((await deps.db.select({ id: beneficiaries.id, last2: beneficiaries.waIdLast2, handle: beneficiaries.webHandle, language: beneficiaries.language }).from(beneficiaries)
    .where(inArray(beneficiaries.id, [...new Set(rows.map((r) => r.beneficiaryId))]))).map((b) => [b.id, b]));
  const next = new Map<string, typeof buddySessions.$inferSelect>();
  for (const s of await deps.db.selectDistinctOn([buddySessions.matchId]).from(buddySessions)
    .where(and(inArray(buddySessions.matchId, ids), eq(buddySessions.status, "scheduled"), sql`${buddySessions.startsAt} > ${deps.now()}`))
    .orderBy(buddySessions.matchId, asc(buddySessions.startsAt))) next.set(s.matchId, s);
  const reports = new Map((await deps.db.select({ id: buddyReports.matchId, n: sql<number>`count(*)::int` }).from(buddyReports)
    .where(and(inArray(buddyReports.matchId, ids), eq(buddyReports.status, "open"))).groupBy(buddyReports.matchId)).map((r) => [r.id, r.n]));
  return rows.map((r) => {
    const b = bens.get(r.beneficiaryId);
    const s = next.get(r.id);
    return {
      id: r.id, requestId: r.requestId, status: r.status,
      volunteer: { id: r.volunteerId, name: vols.get(r.volunteerId) ?? "" },
      beneficiaryLabel: maskedLabel(b?.last2 ?? "••", b?.handle), beneficiaryLanguage: b?.language ?? "fr",
      weekday: r.weekday, time: r.time, mode: r.mode as BuddyMode, place: r.place, contactShared: r.contactShared,
      createdAt: r.createdAt.toISOString(), acceptedAt: r.acceptedAt?.toISOString() ?? null, endedAt: r.endedAt?.toISOString() ?? null,
      endedBy: r.endedBy, openReports: reports.get(r.id) ?? 0,
      nextSession: s ? { id: s.id, startsAt: s.startsAt.toISOString(), status: s.status, cancelledBy: s.cancelledBy as "beneficiary" | "volunteer" | null } : null,
    };
  });
}
const toMatch = async (deps: Deps, r: MatchRow) => (await toMatches(deps, [r]))[0]!;

async function detail(ctx: RpcContext & { volunteer: Volunteer }, m: MatchRow, withMessages: boolean): Promise<BuddyMatchDetail> {
  const { deps } = ctx;
  const sessions = await deps.db.select().from(buddySessions).where(eq(buddySessions.matchId, m.id)).orderBy(desc(buddySessions.startsAt)).limit(12);
  let msgs: BuddyMatchDetail["messages"] = null;
  if (withMessages) {
    const dek = await getServices(deps).beneficiaries.getDek(m.beneficiaryId);
    const rows = await deps.db.select().from(buddyMessages).where(eq(buddyMessages.matchId, m.id)).orderBy(asc(buddyMessages.createdAt));
    msgs = rows.map((r) => ({ id: r.id, author: r.author as "beneficiary" | "volunteer", text: deps.crypto.decrypt(dek, r.bodyEnc).toString("utf8"), at: r.createdAt.toISOString() }));
  }
  return {
    ...(await toMatch(deps, m)),
    sessions: sessions.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), status: s.status, cancelledBy: s.cancelledBy as "beneficiary" | "volunteer" | null })),
    messages: msgs,
  };
}

async function hasReports(deps: Deps, matchId: string): Promise<boolean> {
  const [r] = await deps.db.select({ id: buddyReports.id }).from(buddyReports).where(eq(buddyReports.matchId, matchId)).limit(1);
  return !!r;
}

async function toReports(deps: Deps, rows: (typeof buddyReports.$inferSelect)[]): Promise<BuddyReport[]> {
  if (!rows.length) return [];
  const matches = new Map((await deps.db.select().from(buddyMatches).where(inArray(buddyMatches.id, rows.map((r) => r.matchId)))).map((m) => [m.id, m]));
  const people = await toMatches(deps, [...matches.values()]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const handlerIds = [...new Set(rows.flatMap((r) => (r.handledBy ? [r.handledBy] : [])))];
  const handlers = new Map(handlerIds.length ? (await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, handlerIds))).map((v) => [v.id, v.name]) : []);
  const ben = getServices(deps).beneficiaries;
  return Promise.all(rows.map(async (r) => {
    const m = matches.get(r.matchId)!;
    const dek = await ben.getDek(m.beneficiaryId);
    const p = byId.get(r.matchId)!;
    return {
      id: r.id, matchId: r.matchId, by: r.by as "beneficiary" | "volunteer", volunteerName: p.volunteer.name, beneficiaryLabel: p.beneficiaryLabel,
      text: deps.crypto.decrypt(dek, r.textEnc).toString("utf8"), status: r.status, createdAt: r.createdAt.toISOString(), resolution: r.resolution,
      note: r.noteEnc ? deps.crypto.decrypt(dek, r.noteEnc).toString("utf8") : null, handledByName: r.handledBy ? (handlers.get(r.handledBy) ?? null) : null,
    };
  }));
}

export const buddiesRouter = {
  myProfile: os.buddies.myProfile.use(requirePermission(BE)).handler(async ({ context }) => {
    const [p] = await context.deps.db.select().from(buddyProfiles).where(eq(buddyProfiles.volunteerId, context.volunteer.id)).limit(1);
    return p ? { active: p.active, languages: p.languages, slots: p.slots as BuddySlot[], modes: p.modes as BuddyMode[], maxBuddies: p.maxBuddies, meetPlace: p.meetPlace } : null;
  }),

  saveProfile: os.buddies.saveProfile.use(requirePermission(BE)).handler(async ({ input, context }) => {
    const values = { ...input, languages: [...new Set(input.languages)], modes: [...new Set(input.modes)], meetPlace: input.meetPlace?.trim() || null, updatedAt: context.deps.now() };
    await context.deps.db.insert(buddyProfiles).values({ volunteerId: context.volunteer.id, ...values })
      .onConflictDoUpdate({ target: buddyProfiles.volunteerId, set: values });
    await logAccess(context, "buddies.save_profile", context.volunteer.id);
    return { active: values.active, languages: values.languages, slots: values.slots, modes: values.modes, maxBuddies: values.maxBuddies, meetPlace: values.meetPlace };
  }),

  requests: os.buddies.requests.use(requireAny(BE, MANAGE)).handler(async ({ context }) => {
    const { db } = context.deps;
    const rows = await db.select({ r: buddyRequests, last2: beneficiaries.waIdLast2, handle: beneficiaries.webHandle, language: beneficiaries.language }).from(buddyRequests)
      .innerJoin(beneficiaries, eq(beneficiaries.id, buddyRequests.beneficiaryId))
      .where(eq(buddyRequests.status, "waiting")).orderBy(asc(buddyRequests.createdAt));
    const proposed = new Set(rows.length ? (await db.select({ id: buddyMatches.requestId }).from(buddyMatches)
      .where(and(inArray(buddyMatches.requestId, rows.map((x) => x.r.id)), inArray(buddyMatches.status, OPEN_MATCH)))).map((x) => x.id) : []);
    return rows.map(({ r, last2, handle, language }): BuddyRequest => ({
      id: r.id, beneficiaryLabel: maskedLabel(last2, handle), language, windows: r.windows as BuddyRequest["windows"], mode: r.mode as BuddyRequest["mode"],
      status: r.status, createdAt: r.createdAt.toISOString(), proposed: proposed.has(r.id),
    }));
  }),

  candidates: os.buddies.candidates.use(requirePermission(MANAGE)).handler(({ input }) => guard(() => svc().candidates(input.requestId))),

  propose: os.buddies.propose.use(requireAny(BE, MANAGE)).handler(async ({ input, context }) => {
    const self = context.volunteer.id;
    const volunteerId = input.volunteerId ?? self;
    // Proposing yourself needs be_buddy; proposing someone else needs manage.
    if (!can(context.volunteer, volunteerId === self ? BE : MANAGE)) throw new ORPCError("FORBIDDEN");
    const id = await guard(() => svc().propose({ ...input, volunteerId, place: input.place ?? null, proposedBy: self }));
    await logAccess(context, "buddies.propose", id);
    return toMatch(context.deps, await matchRow(context.deps, id));
  }),

  mine: os.buddies.mine.use(requirePermission(BE)).handler(async ({ context }) => {
    const { db } = context.deps;
    const me = eq(buddyMatches.volunteerId, context.volunteer.id);
    const open = await db.select().from(buddyMatches).where(and(me, inArray(buddyMatches.status, OPEN_MATCH))).orderBy(asc(buddyMatches.createdAt));
    const past = await db.select().from(buddyMatches).where(and(me, notInArray(buddyMatches.status, OPEN_MATCH))).orderBy(desc(buddyMatches.createdAt)).limit(20);
    return toMatches(context.deps, [...open, ...past]);
  }),

  all: os.buddies.all.use(requirePermission(MANAGE)).handler(async ({ input, context }) => {
    const rows = await context.deps.db.select().from(buddyMatches)
      .where(input.status ? eq(buddyMatches.status, input.status) : undefined).orderBy(desc(buddyMatches.createdAt)).limit(200);
    return toMatches(context.deps, rows);
  }),

  get: os.buddies.get.use(requireAny(BE, MANAGE, REPORTS)).handler(async ({ input, context }) => {
    const v = context.volunteer;
    const m = await matchRow(context.deps, input.id);
    const own = can(v, BE) && m.volunteerId === v.id;
    // Messages: the buddy themself, or whoever handles a report on this pairing (logged). Managers see the pairing only.
    const reviewer = !own && can(v, REPORTS) && (await hasReports(context.deps, m.id));
    if (!own && !reviewer && !can(v, MANAGE)) throw new ORPCError("FORBIDDEN");
    if (reviewer) await logAccess(context, "buddies.view_messages", m.id);
    return detail(context, m, own || reviewer);
  }),

  sendMessage: os.buddies.sendMessage.use(requirePermission(BE)).handler(async ({ input, context }) => {
    const m = await ownMatch(context, input.matchId);
    await guard(() => svc().messageFromVolunteer(m.id, input.text));
    await logAccess(context, "buddies.message", m.id);
    return detail(context, await matchRow(context.deps, m.id), true);
  }),

  skipSession: os.buddies.skipSession.use(requirePermission(BE)).handler(async ({ input, context }) => {
    const [s] = await context.deps.db.select().from(buddySessions).where(eq(buddySessions.id, input.sessionId)).limit(1);
    if (!s) throw new ORPCError("NOT_FOUND");
    const m = await ownMatch(context, s.matchId);
    if (m.status !== "active") throw new ORPCError("CONFLICT", { data: { reason: "not_active" } });
    await guard(() => svc().skipSession(s.id, "volunteer"));
    await logAccess(context, "buddies.skip_session", m.id);
    return detail(context, await matchRow(context.deps, m.id), true);
  }),

  end: os.buddies.end.use(requireAny(BE, MANAGE)).handler(async ({ input, context }) => {
    const v = context.volunteer;
    const m = await matchRow(context.deps, input.matchId);
    const own = can(v, BE) && m.volunteerId === v.id;
    if (!own && !can(v, MANAGE)) throw new ORPCError("FORBIDDEN");
    await guard(() => svc().end(m.id, own ? "volunteer" : "coordinator"));
    await logAccess(context, "buddies.end", m.id);
    return toMatch(context.deps, await matchRow(context.deps, m.id));
  }),

  contact: os.buddies.contact.use(requirePermission(BE)).handler(async ({ input, context }) => {
    const m = await ownMatch(context, input.matchId);
    if (m.status !== "active" || !m.contactShared) throw new ORPCError("FORBIDDEN");
    const { channel, address: waId } = await getServices(context.deps).beneficiaries.getAddress(m.beneficiaryId);
    if (channel === "web") throw new ORPCError("FORBIDDEN"); // a web account has no phone number
    // No phone number to give: WhatsApp hides it (username, BSUID only), or the channel has none (Telegram chat id).
    if ((channel !== "whatsapp" && channel !== "sms") || isBsuid(waId)) throw new ORPCError("NOT_FOUND", { message: "no phone number for this person" });
    await logAccess(context, "buddies.contact", m.id);
    return { phone: `+${waId.replace(/^\+/, "")}` };
  }),

  report: os.buddies.report.use(requirePermission(BE)).handler(async ({ input, context }) => {
    const m = await ownMatch(context, input.matchId);
    await guard(() => svc().report(m.id, "volunteer", input.text));
    await logAccess(context, "buddies.report", m.id);
    return toMatch(context.deps, await matchRow(context.deps, m.id));
  }),

  reports: os.buddies.reports.use(requirePermission(REPORTS)).handler(async ({ input, context }) => {
    const rows = await context.deps.db.select().from(buddyReports).where(eq(buddyReports.status, input.status))
      .orderBy(input.status === "open" ? asc(buddyReports.createdAt) : desc(buddyReports.createdAt)).limit(100);
    await logAccess(context, "buddies.reports", null);
    return toReports(context.deps, rows);
  }),

  resolveReport: os.buddies.resolveReport.use(requirePermission(REPORTS)).handler(async ({ input, context }) => {
    await guard(() => svc().resolveReport(input.id, input.action, input.note?.trim() || null, context.volunteer.id));
    await logAccess(context, `buddies.resolve_report:${input.action}`, input.id);
    const [r] = await context.deps.db.select().from(buddyReports).where(eq(buddyReports.id, input.id));
    return (await toReports(context.deps, [r!]))[0]!;
  }),

  counts: os.buddies.counts.use(requireAny(BE, MANAGE, REPORTS)).handler(async ({ context }) => {
    const v = context.volunteer;
    const { db } = context.deps;
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const waiting = can(v, BE) || can(v, MANAGE)
      ? await n(db.select({ n: sql<number>`count(*)::int` }).from(buddyRequests).where(eq(buddyRequests.status, "waiting")))
      : 0;
    const openReports = can(v, REPORTS) ? await n(db.select({ n: sql<number>`count(*)::int` }).from(buddyReports).where(eq(buddyReports.status, "open"))) : 0;
    return { waiting, openReports };
  }),
};
