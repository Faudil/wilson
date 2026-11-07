/**
 * French practice buddies — domain logic shared by the WhatsApp flow (conversation/buddyFlow.ts), the back-office
 * (rpc/buddies.ts) and the buddy.dispatch cron. Permission checks live in the RPC layer; this file enforces the
 * state rules (who can be matched, what each status allows) so no caller can skip them.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lte, lt, sql } from "drizzle-orm";
import {
  windowOfSlot, type BuddyCandidate, type BuddyMode, type BuddyModePreference, type BuddySlot, type BuddyWindow, type Permission,
  type VolunteerRole,
} from "@wilson/contracts";
import { buddyHow, buddyText, formatDate, type BuddyKey, type Params } from "@wilson/i18n";
import { effectivePermissions } from "../auth/service.js";
import {
  buddyMatches, buddyMessages, buddyProfiles, buddyReports, buddyRequests, buddySessions, messages, volunteerPermissions, volunteers,
} from "../db/schema.js";
import type { Deps } from "../deps.js";
import { JOBS } from "../jobs/names.js";
import { getServices } from "../services.js";
import { addDays, localDate, zonedTime } from "../time.js";
import { footerFor } from "../whatsapp/send.js";

export class BuddyError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "FORBIDDEN", readonly reason: string) {
    super(reason);
    this.name = "BuddyError";
  }
}

export type MatchRow = typeof buddyMatches.$inferSelect;
export type RequestRow = typeof buddyRequests.$inferSelect;
export type SessionRow = typeof buddySessions.$inferSelect;
export type Party = "beneficiary" | "volunteer" | "coordinator";

/** Pairings that hold a volunteer's spot and block a new request from the same person. */
export const OPEN_MATCH: MatchRow["status"][] = ["proposed", "active", "suspended"];
/** A proposal the beneficiary never answered is dropped after this many days (the request stays on the list). */
export const PROPOSAL_TTL_DAYS = 7;
/** Reminder this long before a session. */
const REMINDER_MS = 24 * 3600_000;
/** A scheduled session is considered held this long after it started. */
const SESSION_LENGTH_MS = 2 * 3600_000;

/** Only the first name is ever shown to a beneficiary. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
const isoWeekday = (isoDate: string): number => ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** First instant strictly after `after` when the wall clock in `tz` shows `weekday` at `time`. DST-safe. */
export function nextOccurrence(weekday: number, time: string, after: Date, tz: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const start = localDate(after, tz);
  for (let i = 0; i <= 14; i++) {
    const d = addDays(start, i);
    if (isoWeekday(d) !== weekday) continue;
    const at = new Date(zonedTime(d, h, tz).getTime() + m * 60_000);
    if (at > after) return at;
  }
  throw new Error("unreachable: a weekday occurs within 14 days");
}

/** Score a volunteer for a request: speaks the person's language (+2), a slot in their windows (+3), spare capacity (+0.1 each). */
export function scoreCandidate(input: { sharedLanguage: boolean; matchingSlots: number; freeSpots: number }): number {
  return (input.sharedLanguage ? 2 : 0) + (input.matchingSlots > 0 ? 3 : 0) + input.freeSpots * 0.1;
}

export function modeFits(pref: BuddyModePreference, modes: BuddyMode[]): boolean {
  return pref === "either" ? modes.length > 0 : modes.includes(pref);
}

export interface BuddyService {
  // — beneficiary side (WhatsApp) —
  /** The person's waiting request and their current pairing (proposed, active or suspended), if any. */
  openFor(beneficiaryId: string): Promise<{ request: RequestRow | null; match: MatchRow | null }>;
  createRequest(beneficiaryId: string, windows: BuddyWindow[], mode: BuddyModePreference): Promise<string>;
  cancelRequest(beneficiaryId: string): Promise<void>;
  accept(matchId: string): Promise<SessionRow | null>;
  decline(matchId: string): Promise<void>;
  setConsent(matchId: string, shared: boolean): Promise<void>;
  messageFromBeneficiary(matchId: string, text: string): Promise<void>;
  // — both sides —
  nextSession(matchId: string): Promise<SessionRow | null>;
  skipNext(matchId: string, by: "beneficiary" | "volunteer"): Promise<SessionRow | null>;
  skipSession(sessionId: string, by: "beneficiary" | "volunteer"): Promise<SessionRow>;
  end(matchId: string, by: Party): Promise<void>;
  report(matchId: string, by: "beneficiary" | "volunteer", text: string): Promise<void>;
  // — volunteer side (back-office) —
  isBuddy(volunteerId: string): Promise<boolean>;
  candidates(requestId: string): Promise<BuddyCandidate[]>;
  propose(input: { requestId: string; volunteerId: string; weekday: number; time: string; mode: BuddyMode; place: string | null; proposedBy: string }): Promise<string>;
  messageFromVolunteer(matchId: string, text: string): Promise<void>;
  resolveReport(reportId: string, action: "resume" | "end", note: string | null, handledBy: string): Promise<void>;
  // — lifecycle —
  endAllForBeneficiary(beneficiaryId: string): Promise<void>;
  endAllForVolunteer(volunteerId: string): Promise<void>;
  /** Cron: expire stale proposals, close past sessions, schedule the next ones, send due reminders. Returns reminders sent. */
  dispatch(now: Date): Promise<number>;
  /** Texts for the WhatsApp flow. */
  describe(match: MatchRow, session: SessionRow | null, lang: Parameters<typeof buddyText>[0]): Promise<{ name: string; date: string; time: string; how: string }>;
}

const cache = new WeakMap<object, BuddyService>();
export function getBuddies(deps: Deps): BuddyService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createBuddyService(deps)));
  return s;
}

export function createBuddyService(deps: Deps): BuddyService {
  const { db, crypto, config, jobs } = deps;
  const ben = getServices(deps).beneficiaries;
  const tz = config.TIMEZONE;

  async function mustMatch(id: string): Promise<MatchRow> {
    const [m] = await db.select().from(buddyMatches).where(eq(buddyMatches.id, id)).limit(1);
    if (!m) throw new BuddyError("NOT_FOUND", "match");
    return m;
  }
  async function volunteerName(id: string): Promise<string> {
    const [v] = await db.select({ name: volunteers.name }).from(volunteers).where(eq(volunteers.id, id)).limit(1);
    return firstName(v?.name ?? "");
  }

  /**
   * Message to the beneficiary, stored like a chat message (author system) and sent through wa.send: outside the
   * 24 h window it waits behind the opt-in template and goes out on their next message.
   */
  async function notify(beneficiaryId: string, key: BuddyKey, params: Params = {}, volunteerId: string | null = null): Promise<void> {
    const b = await ben.get(beneficiaryId);
    if (!b || b.archivedAt) return;
    const dek = await ben.getDek(beneficiaryId);
    const body = `${buddyText(b.language, key, params)}\n\n${footerFor(deps, b.language)}`;
    const [row] = await db.insert(messages).values({
      beneficiaryId, direction: "out", kind: "text", status: "queued", bodyEnc: crypto.encrypt(dek, body),
      author: "system", chatState: "sent", volunteerId,
    }).returning({ id: messages.id });
    await jobs.send(JOBS.waSend, { kind: "chat", messageId: row!.id });
  }

  async function describe(match: MatchRow, session: SessionRow | null, lang: Parameters<typeof buddyText>[0]) {
    const at = session?.startsAt ?? nextOccurrence(match.weekday, match.time, deps.now(), tz);
    return {
      name: await volunteerName(match.volunteerId),
      date: formatDate(localDate(at, tz), lang, { weekday: true }),
      time: match.time,
      how: buddyHow(lang, match.mode, match.place),
    };
  }

  async function nextSession(matchId: string): Promise<SessionRow | null> {
    const [s] = await db.select().from(buddySessions)
      .where(and(eq(buddySessions.matchId, matchId), eq(buddySessions.status, "scheduled"), gt(buddySessions.startsAt, deps.now())))
      .orderBy(asc(buddySessions.startsAt)).limit(1);
    return s ?? null;
  }

  /** Make sure an active pairing has its next weekly session. A skipped session pushes the next one a week later. */
  async function ensureNext(m: MatchRow, now: Date): Promise<SessionRow | null> {
    if (m.status !== "active") return null;
    const existing = await nextSession(m.id);
    if (existing) return existing;
    const [last] = await db.select({ at: buddySessions.startsAt }).from(buddySessions)
      .where(eq(buddySessions.matchId, m.id)).orderBy(desc(buddySessions.startsAt)).limit(1);
    const after = last && last.at > now ? last.at : now;
    const startsAt = nextOccurrence(m.weekday, m.time, after, tz);
    await db.insert(buddySessions).values({ matchId: m.id, startsAt }).onConflictDoNothing();
    return nextSession(m.id);
  }

  async function cancelFutureSessions(matchId: string) {
    await db.update(buddySessions).set({ status: "cancelled" })
      .where(and(eq(buddySessions.matchId, matchId), eq(buddySessions.status, "scheduled"), gt(buddySessions.startsAt, deps.now())));
  }

  async function profileOf(volunteerId: string) {
    const [p] = await db.select().from(buddyProfiles).where(eq(buddyProfiles.volunteerId, volunteerId)).limit(1);
    return p ?? null;
  }

  async function openCount(volunteerId: string): Promise<number> {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(buddyMatches)
      .where(and(eq(buddyMatches.volunteerId, volunteerId), inArray(buddyMatches.status, OPEN_MATCH)));
    return r?.n ?? 0;
  }

  /** Volunteers who may be someone's buddy right now: approved, not disabled, holding buddies.be_buddy. */
  async function buddyVolunteers(ids?: string[]): Promise<Map<string, typeof volunteers.$inferSelect>> {
    const rows = await db.select().from(volunteers)
      .where(and(eq(volunteers.pendingApproval, false), isNull(volunteers.disabledAt), ids ? inArray(volunteers.id, ids) : undefined));
    if (!rows.length) return new Map();
    const overrides = await db.select().from(volunteerPermissions).where(inArray(volunteerPermissions.volunteerId, rows.map((r) => r.id)));
    const out = new Map<string, typeof volunteers.$inferSelect>();
    for (const r of rows) {
      const own = overrides.filter((o) => o.volunteerId === r.id) as { permission: Permission; granted: boolean }[];
      if (effectivePermissions(r.role as VolunteerRole, own).includes("buddies.be_buddy")) out.set(r.id, r);
    }
    return out;
  }

  async function openFor(beneficiaryId: string) {
    const [request] = await db.select().from(buddyRequests)
      .where(and(eq(buddyRequests.beneficiaryId, beneficiaryId), eq(buddyRequests.status, "waiting"))).limit(1);
    const [match] = await db.select().from(buddyMatches)
      .where(and(eq(buddyMatches.beneficiaryId, beneficiaryId), inArray(buddyMatches.status, OPEN_MATCH)))
      .orderBy(desc(buddyMatches.createdAt)).limit(1);
    return { request: request ?? null, match: match ?? null };
  }

  async function end(matchId: string, by: Party) {
    const m = await mustMatch(matchId);
    if (!OPEN_MATCH.includes(m.status)) return;
    const [ended] = await db.update(buddyMatches).set({ status: "ended", endedAt: deps.now(), endedBy: by })
      .where(and(eq(buddyMatches.id, matchId), inArray(buddyMatches.status, OPEN_MATCH))).returning({ id: buddyMatches.id });
    if (!ended) return;
    await cancelFutureSessions(matchId);
    // A proposal that never became a pairing gives the request back to the waiting list.
    if (m.status === "proposed" && by !== "beneficiary") return;
    if (by !== "beneficiary") await notify(m.beneficiaryId, "buddy_ended_other", { name: await volunteerName(m.volunteerId) });
  }

  return {
    openFor,
    nextSession,
    describe,

    async createRequest(beneficiaryId, windows, mode) {
      const open = await openFor(beneficiaryId);
      if (open.request) return open.request.id;
      if (open.match) throw new BuddyError("CONFLICT", "has_match");
      const [row] = await db.insert(buddyRequests).values({ beneficiaryId, windows, mode, createdAt: deps.now() }).onConflictDoNothing().returning({ id: buddyRequests.id });
      if (row) return row.id;
      return (await openFor(beneficiaryId)).request!.id;
    },

    async cancelRequest(beneficiaryId) {
      const open = await openFor(beneficiaryId);
      if (open.match?.status === "proposed") {
        await db.update(buddyMatches).set({ status: "declined", endedAt: deps.now(), endedBy: "beneficiary" }).where(eq(buddyMatches.id, open.match.id));
      }
      await db.update(buddyRequests).set({ status: "cancelled" }).where(and(eq(buddyRequests.beneficiaryId, beneficiaryId), eq(buddyRequests.status, "waiting")));
    },

    async accept(matchId) {
      const [m] = await db.update(buddyMatches).set({ status: "active", acceptedAt: deps.now() })
        .where(and(eq(buddyMatches.id, matchId), eq(buddyMatches.status, "proposed"))).returning();
      if (!m) return null;
      await db.update(buddyRequests).set({ status: "matched" }).where(eq(buddyRequests.id, m.requestId));
      return ensureNext(m, deps.now());
    },

    async decline(matchId) {
      await db.update(buddyMatches).set({ status: "declined", endedAt: deps.now(), endedBy: "beneficiary" })
        .where(and(eq(buddyMatches.id, matchId), eq(buddyMatches.status, "proposed")));
    },

    async setConsent(matchId, shared) {
      await db.update(buddyMatches).set({ contactShared: shared }).where(and(eq(buddyMatches.id, matchId), inArray(buddyMatches.status, OPEN_MATCH)));
    },

    async messageFromBeneficiary(matchId, text) {
      const m = await mustMatch(matchId);
      if (m.status !== "active") throw new BuddyError("CONFLICT", "not_active");
      const dek = await ben.getDek(m.beneficiaryId);
      await db.insert(buddyMessages).values({ matchId, author: "beneficiary", bodyEnc: crypto.encrypt(dek, text.trim()), createdAt: deps.now() });
    },

    async messageFromVolunteer(matchId, text) {
      const m = await mustMatch(matchId);
      if (m.status !== "active") throw new BuddyError("CONFLICT", "not_active");
      const dek = await ben.getDek(m.beneficiaryId);
      await db.insert(buddyMessages).values({ matchId, author: "volunteer", bodyEnc: crypto.encrypt(dek, text.trim()), createdAt: deps.now() });
      await notify(m.beneficiaryId, "buddy_from", { name: await volunteerName(m.volunteerId), text: text.trim() }, m.volunteerId);
    },

    async skipNext(matchId, by) {
      const s = await nextSession(matchId);
      if (!s) return null;
      return this.skipSession(s.id, by);
    },

    async skipSession(sessionId, by) {
      const [s] = await db.update(buddySessions).set({ status: "cancelled", cancelledBy: by })
        .where(and(eq(buddySessions.id, sessionId), eq(buddySessions.status, "scheduled"), gt(buddySessions.startsAt, deps.now()))).returning();
      if (!s) throw new BuddyError("CONFLICT", "not_scheduled");
      const m = await mustMatch(s.matchId);
      await ensureNext(m, deps.now());
      if (by === "volunteer") {
        const b = await ben.get(m.beneficiaryId);
        if (b) await notify(m.beneficiaryId, "buddy_other_skipped", { name: await volunteerName(m.volunteerId), date: formatDate(localDate(s.startsAt, tz), b.language, { weekday: true }) });
      }
      return s;
    },

    end,

    async report(matchId, by, text) {
      const m = await mustMatch(matchId);
      if (!OPEN_MATCH.includes(m.status)) throw new BuddyError("CONFLICT", "not_open");
      const dek = await ben.getDek(m.beneficiaryId);
      await db.insert(buddyReports).values({ matchId, by, textEnc: crypto.encrypt(dek, text.trim()), createdAt: deps.now() });
      // Safety first: the pairing stops at once (no reminders, no relayed messages) until someone looks at it.
      await db.update(buddyMatches).set({ status: "suspended" }).where(and(eq(buddyMatches.id, matchId), inArray(buddyMatches.status, ["proposed", "active"])));
      if (by === "volunteer") await notify(m.beneficiaryId, "buddy_paused", { name: await volunteerName(m.volunteerId) });
    },

    async isBuddy(volunteerId) {
      return (await buddyVolunteers([volunteerId])).has(volunteerId);
    },

    async candidates(requestId) {
      const [r] = await db.select().from(buddyRequests).where(eq(buddyRequests.id, requestId)).limit(1);
      if (!r) throw new BuddyError("NOT_FOUND", "request");
      const b = await ben.get(r.beneficiaryId);
      const profiles = await db.select().from(buddyProfiles).where(eq(buddyProfiles.active, true));
      const eligible = await buddyVolunteers(profiles.map((p) => p.volunteerId));
      const out: BuddyCandidate[] = [];
      for (const p of profiles) {
        const v = eligible.get(p.volunteerId);
        if (!v || !modeFits(r.mode, p.modes as BuddyMode[])) continue;
        const freeSpots = p.maxBuddies - (await openCount(p.volunteerId));
        if (freeSpots <= 0) continue;
        const matchingSlots = (p.slots as BuddySlot[]).filter((s) => r.windows.includes(windowOfSlot(s)));
        const sharedLanguage = !!b && b.language !== "fr" && p.languages.includes(b.language);
        out.push({
          volunteerId: v.id, name: v.name, languages: p.languages, sharedLanguage, matchingSlots, modes: p.modes as BuddyMode[], freeSpots,
          score: scoreCandidate({ sharedLanguage, matchingSlots: matchingSlots.length, freeSpots }),
        });
      }
      return out.sort((a, z) => z.score - a.score || a.name.localeCompare(z.name, "fr"));
    },

    async propose(input) {
      const [r] = await db.select().from(buddyRequests).where(eq(buddyRequests.id, input.requestId)).limit(1);
      if (!r) throw new BuddyError("NOT_FOUND", "request");
      if (r.status !== "waiting") throw new BuddyError("CONFLICT", "not_waiting");
      const open = await openFor(r.beneficiaryId);
      if (open.match) throw new BuddyError("CONFLICT", open.match.status === "proposed" ? "already_proposed" : "has_match");
      if (!(await this.isBuddy(input.volunteerId))) throw new BuddyError("CONFLICT", "not_a_buddy");
      const profile = await profileOf(input.volunteerId);
      if (!profile) throw new BuddyError("CONFLICT", "no_profile");
      if ((await openCount(input.volunteerId)) >= profile.maxBuddies) throw new BuddyError("CONFLICT", "full");
      if (input.mode === "meet" && !(input.place ?? profile.meetPlace)) throw new BuddyError("CONFLICT", "no_place");
      const [m] = await db.insert(buddyMatches).values({
        requestId: r.id, beneficiaryId: r.beneficiaryId, volunteerId: input.volunteerId, weekday: input.weekday, time: input.time,
        mode: input.mode, place: input.mode === "meet" ? (input.place ?? profile.meetPlace) : null, proposedBy: input.proposedBy, createdAt: deps.now(),
      }).returning({ id: buddyMatches.id });
      await notify(r.beneficiaryId, "buddy_found");
      return m!.id;
    },

    async resolveReport(reportId, action, note, handledBy) {
      const [rep] = await db.select().from(buddyReports).where(eq(buddyReports.id, reportId)).limit(1);
      if (!rep) throw new BuddyError("NOT_FOUND", "report");
      if (rep.status !== "open") throw new BuddyError("CONFLICT", "closed");
      const m = await mustMatch(rep.matchId);
      const dek = await ben.getDek(m.beneficiaryId);
      await db.update(buddyReports).set({
        status: "closed", resolution: action === "resume" ? "resumed" : "ended", noteEnc: note ? crypto.encrypt(dek, note) : null, handledBy, handledAt: deps.now(),
      }).where(eq(buddyReports.id, reportId));
      if (action === "end") return end(m.id, "coordinator");
      const [stillOpen] = await db.select({ n: sql<number>`count(*)::int` }).from(buddyReports).where(and(eq(buddyReports.matchId, m.id), eq(buddyReports.status, "open")));
      if ((stillOpen?.n ?? 0) > 0 || m.status !== "suspended") return;
      // A proposal that was reported before any yes goes back to "proposed"; an accepted pairing resumes.
      const back = m.acceptedAt ? "active" : "proposed";
      const [resumed] = await db.update(buddyMatches).set({ status: back }).where(and(eq(buddyMatches.id, m.id), eq(buddyMatches.status, "suspended"))).returning();
      if (!resumed || back !== "active") return;
      const s = await ensureNext(resumed, deps.now());
      const b = await ben.get(m.beneficiaryId);
      if (b) {
        const d = await describe(resumed, s, b.language);
        await notify(m.beneficiaryId, "buddy_resumed", { name: d.name, date: d.date, time: d.time });
      }
    },

    async endAllForBeneficiary(beneficiaryId) {
      await db.update(buddyRequests).set({ status: "cancelled" }).where(and(eq(buddyRequests.beneficiaryId, beneficiaryId), eq(buddyRequests.status, "waiting")));
      const open = await db.select({ id: buddyMatches.id }).from(buddyMatches)
        .where(and(eq(buddyMatches.beneficiaryId, beneficiaryId), inArray(buddyMatches.status, OPEN_MATCH)));
      for (const m of open) await end(m.id, "beneficiary");
    },

    async endAllForVolunteer(volunteerId) {
      const open = await db.select({ id: buddyMatches.id }).from(buddyMatches)
        .where(and(eq(buddyMatches.volunteerId, volunteerId), inArray(buddyMatches.status, OPEN_MATCH)));
      for (const m of open) await end(m.id, "coordinator");
    },

    async dispatch(now) {
      // 1. Proposals nobody answered: dropped, the request stays on the waiting list.
      await db.update(buddyMatches).set({ status: "declined", endedAt: now })
        .where(and(eq(buddyMatches.status, "proposed"), lt(buddyMatches.createdAt, new Date(now.getTime() - PROPOSAL_TTL_DAYS * 86_400_000))));
      // 2. Past sessions are done.
      await db.update(buddySessions).set({ status: "done" })
        .where(and(eq(buddySessions.status, "scheduled"), lte(buddySessions.startsAt, new Date(now.getTime() - SESSION_LENGTH_MS))));
      // 3. Every active pairing has its next session.
      for (const m of await db.select().from(buddyMatches).where(eq(buddyMatches.status, "active"))) await ensureNext(m, now);
      // 4. Reminders, the day before, exactly once (claimed with an atomic update), only for active pairings.
      const due = await db.select({ s: buddySessions, m: buddyMatches }).from(buddySessions)
        .innerJoin(buddyMatches, eq(buddyMatches.id, buddySessions.matchId))
        .where(and(
          eq(buddySessions.status, "scheduled"), isNull(buddySessions.remindedAt), eq(buddyMatches.status, "active"),
          gt(buddySessions.startsAt, now), lte(buddySessions.startsAt, new Date(now.getTime() + REMINDER_MS)),
        ));
      let sent = 0;
      for (const { s, m } of due) {
        const [claimed] = await db.update(buddySessions).set({ remindedAt: now })
          .where(and(eq(buddySessions.id, s.id), isNull(buddySessions.remindedAt))).returning({ id: buddySessions.id });
        if (!claimed) continue;
        const b = await ben.get(m.beneficiaryId);
        if (!b || b.archivedAt) continue;
        await notify(m.beneficiaryId, "buddy_reminder", await describe(m, s, b.language));
        sent++;
      }
      return sent;
    },
  };
}
