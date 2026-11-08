/**
 * Agenda: events of the association (maraude, meeting, training, workshop…) and who signs up (see contracts/events.ts).
 *
 * Scope: an event belongs to one association (its members see it) or to everyone (association_id null). Global admins
 * (`associations.manage`) see and choose any. Anything out of scope answers NOT_FOUND, never FORBIDDEN, so ids leak
 * nothing.
 *
 * Places: volunteers and beneficiaries have separate limits. Joining a full side puts you on its waiting list; when a
 * "going" row goes away (or the limit is raised), the oldest waiting rows of that side move up. All of it runs in one
 * transaction with the event row locked, so two people never get the last place.
 *
 * Beneficiaries (public events, WhatsApp menu 8 → 4) are never shown to volunteers: only how many and in which
 * languages. What they get (registered, moved up, reminder, changed, cancelled) is a chat row, like Rendez-vous, so it
 * shows in Conversations and waits behind the opt-in template outside the 24 h window.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { isRtl, type Event, type EventAttendee, type EventInput, type EventKind, type EventRegistrationStatus, type LanguageCode, type Permission, type Volunteer } from "@wilson/contracts";
import { eventText, formatDate, formatTime, isolate, type EventKey } from "@wilson/i18n";
import type { Deps } from "../deps.js";
import { associations, beneficiaries, eventRegistrations, events, messages, volunteerSkills, volunteers } from "../db/schema.js";
import { DomainError } from "../errors.js";
import { JOBS } from "../jobs/names.js";
import { getServices } from "../services.js";
import { addDays, localDate, localTime, zonedDateTime } from "../time.js";
import { withUsageContext } from "../usage/context.js";
import { footerFor } from "../whatsapp/send.js";

export type EventRow = typeof events.$inferSelect;
type RegRow = typeof eventRegistrations.$inferSelect;
type Db = Deps["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Side = "volunteer" | "beneficiary";

const HOUR = 3_600_000;
const RLM = "‏";
/** Offered on WhatsApp: public events starting within this many days (at most WA_LIST_LIMIT of them). */
const WA_AHEAD_DAYS = 60;
export const WA_LIST_LIMIT = 9; // + "0 - back" = 10 rows, WhatsApp's list maximum
/** The day-before reminder goes out from this long before the start. */
const REMINDER_BEFORE_MS = 24 * HOUR;
/** "past" view: how far back. */
const PAST_DAYS = 90;

export const EVENT_EMOJI: Record<EventKind, string> = { maraude: "🚶", meeting: "🗣️", training: "🎓", workshop: "🛠️", info_session: "ℹ️", other: "📌" };

export class EventError extends DomainError {
  constructor(code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT", reason?: string) {
    super(code, reason ?? code);
    this.name = "EventError";
  }
}

const can = (v: Volunteer, p: Permission) => v.permissions.includes(p);
/** Sees and manages every association's events (and creates for everyone). */
export const isGlobal = (v: Volunteer) => can(v, "associations.manage");

export function visibleTo(v: Volunteer, r: Pick<EventRow, "associationId">): boolean {
  return r.associationId === null || isGlobal(v) || r.associationId === v.association?.id;
}

export function canEdit(v: Volunteer, r: Pick<EventRow, "associationId" | "createdBy">): boolean {
  if (!visibleTo(v, r)) return false;
  if (can(v, "events.create") && r.createdBy === v.id) return true;
  if (!can(v, "events.manage")) return false;
  // Association admins manage their association's events, not the ones for everyone.
  return isGlobal(v) || (r.associationId !== null && r.associationId === v.association?.id);
}

export type JoinResult = { status: EventRegistrationStatus; position: number | null };

const cache = new WeakMap<object, ReturnType<typeof createEventsService>>();
export function getEvents(deps: Deps) {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createEventsService(deps)));
  return s;
}

export function createEventsService(deps: Deps) {
  const { db, crypto, config, jobs, llm } = deps;
  const tz = config.TIMEZONE;
  const now = () => deps.now();
  const ben = () => getServices(deps).beneficiaries;

  // ------------------------------------------------------------------------------------------------ helpers

  const scopeWhere = (v: Volunteer): SQL | undefined =>
    isGlobal(v) ? undefined : v.association ? or(isNull(events.associationId), eq(events.associationId, v.association.id)) : isNull(events.associationId);

  async function mustRow(id: string, tx: Pick<Db, "select"> = db): Promise<EventRow> {
    const [r] = await tx.select().from(events).where(eq(events.id, id)).limit(1);
    if (!r) throw new EventError("NOT_FOUND");
    return r;
  }
  async function visibleRow(v: Volunteer, id: string): Promise<EventRow> {
    const r = await mustRow(id);
    if (!visibleTo(v, r)) throw new EventError("NOT_FOUND");
    return r;
  }
  async function editableRow(v: Volunteer, id: string): Promise<EventRow> {
    const r = await visibleRow(v, id);
    if (!canEdit(v, r)) throw new EventError("FORBIDDEN");
    return r;
  }

  const sideWhere = (side: Side) => (side === "volunteer" ? isNotNull(eventRegistrations.volunteerId) : isNotNull(eventRegistrations.beneficiaryId));
  const limitOf = (r: EventRow, side: Side) => (side === "volunteer" ? r.volunteerSpots : r.publicSpots);
  const isOver = (r: EventRow, at = now()) => (r.endsAt ?? new Date(r.startsAt.getTime() + 2 * HOUR)).getTime() <= at.getTime();

  async function goingCount(tx: Pick<Db, "select">, eventId: string, side: Side): Promise<number> {
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, eventId), eq(eventRegistrations.status, "going"), sideWhere(side)));
    return c?.n ?? 0;
  }

  /** Position on the waiting list (1 = next), or null when going / not registered. */
  async function positionOf(tx: Pick<Db, "select">, reg: RegRow): Promise<number | null> {
    if (reg.status !== "waitlist") return null;
    const side: Side = reg.volunteerId ? "volunteer" : "beneficiary";
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, reg.eventId), eq(eventRegistrations.status, "waitlist"), sideWhere(side), lte(eventRegistrations.createdAt, reg.createdAt)));
    return c?.n ?? 1;
  }

  /** Move the oldest waiting rows of one side up while there is room. Returns the rows that moved up. */
  async function promote(tx: Tx, r: EventRow, side: Side): Promise<RegRow[]> {
    const limit = limitOf(r, side);
    const room = limit === null ? Number.MAX_SAFE_INTEGER : limit - (await goingCount(tx, r.id, side));
    if (room <= 0) return [];
    const waiting = await tx.select().from(eventRegistrations)
      .where(and(eq(eventRegistrations.eventId, r.id), eq(eventRegistrations.status, "waitlist"), sideWhere(side)))
      .orderBy(asc(eventRegistrations.createdAt)).limit(Math.min(room, 500));
    if (!waiting.length) return [];
    await tx.update(eventRegistrations).set({ status: "going" }).where(inArray(eventRegistrations.id, waiting.map((w) => w.id)));
    return waiting;
  }

  /** Register (idempotent: an existing row is returned as it is). Locks the event row. */
  async function register(eventId: string, who: { volunteerId: string } | { beneficiaryId: string }): Promise<{ result: JoinResult; row: EventRow }> {
    return db.transaction(async (tx) => {
      const [r] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!r) throw new EventError("NOT_FOUND");
      if (r.cancelledAt) throw new EventError("CONFLICT", "cancelled");
      if (r.startsAt.getTime() <= now().getTime()) throw new EventError("CONFLICT", "past");
      const side: Side = "volunteerId" in who ? "volunteer" : "beneficiary";
      if (side === "beneficiary" && !r.public) throw new EventError("NOT_FOUND");
      const mine = "volunteerId" in who ? eq(eventRegistrations.volunteerId, who.volunteerId) : eq(eventRegistrations.beneficiaryId, who.beneficiaryId);
      const [existing] = await tx.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, eventId), mine)).limit(1);
      if (existing) return { result: { status: existing.status, position: await positionOf(tx, existing) }, row: r };
      const limit = limitOf(r, side);
      const status: EventRegistrationStatus = limit === null || (await goingCount(tx, r.id, side)) < limit ? "going" : "waitlist";
      const [reg] = await tx.insert(eventRegistrations).values({ eventId, ...who, status, createdAt: now() }).returning();
      return { result: { status, position: await positionOf(tx, reg!) }, row: r };
    });
  }

  /** Take a registration off; returns whoever moved up on that side. */
  async function unregister(eventId: string, mine: SQL): Promise<{ removed: boolean; promoted: RegRow[]; row: EventRow }> {
    return db.transaction(async (tx) => {
      const [r] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!r) throw new EventError("NOT_FOUND");
      const gone = await tx.delete(eventRegistrations).where(and(eq(eventRegistrations.eventId, eventId), mine)).returning();
      if (!gone.length) return { removed: false, promoted: [], row: r };
      const side: Side = gone[0]!.volunteerId ? "volunteer" : "beneficiary";
      const promoted = gone[0]!.status === "going" && !r.cancelledAt ? await promote(tx, r, side) : [];
      return { removed: true, promoted, row: r };
    });
  }

  // --------------------------------------------------------------------------------- DTOs (back-office)

  async function toEvents(v: Volunteer, rows: EventRow[]): Promise<Event[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const regs = await db.select().from(eventRegistrations).where(inArray(eventRegistrations.eventId, ids)).orderBy(asc(eventRegistrations.createdAt));
    const volIds = [...new Set([v.id, ...regs.flatMap((g) => (g.volunteerId ? [g.volunteerId] : [])), ...rows.flatMap((r) => (r.createdBy ? [r.createdBy] : []))])];
    const names = new Map((await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, volIds))).map((x) => [x.id, x.name]));
    const skills = new Map((await db.select().from(volunteerSkills).where(inArray(volunteerSkills.volunteerId, volIds))).map((s) => [s.volunteerId, s]));
    const assocIds = [...new Set(rows.flatMap((r) => (r.associationId ? [r.associationId] : [])))];
    const assocs = new Map(assocIds.length ? (await db.select({ id: associations.id, name: associations.name }).from(associations).where(inArray(associations.id, assocIds))).map((a) => [a.id, a]) : []);
    const benIds = [...new Set(regs.flatMap((g) => (g.beneficiaryId ? [g.beneficiaryId] : [])))];
    const langs = new Map(benIds.length ? (await db.select({ id: beneficiaries.id, language: beneficiaries.language }).from(beneficiaries).where(inArray(beneficiaries.id, benIds))).map((b) => [b.id, b.language as LanguageCode]) : []);

    const matches = (volunteerId: string, r: EventRow) => {
      const s = skills.get(volunteerId);
      if (!s) return false;
      return r.languages.some((l) => s.languages.includes(l)) || r.skills.some((k) => (s.skills as string[]).includes(k));
    };

    return rows.map((r) => {
      const mine = regs.filter((g) => g.eventId === r.id);
      const vol = mine.filter((g) => g.volunteerId);
      const pub = mine.filter((g) => g.beneficiaryId);
      const going = vol.filter((g) => g.status === "going");
      const waiting = vol.filter((g) => g.status === "waitlist");
      const attendees: EventAttendee[] = [...going, ...waiting].map((g) => ({
        volunteerId: g.volunteerId!, name: names.get(g.volunteerId!) ?? "—", status: g.status,
        position: g.status === "waitlist" ? waiting.indexOf(g) + 1 : null, matches: matches(g.volunteerId!, r), createdAt: g.createdAt.toISOString(),
      }));
      const me = vol.find((g) => g.volunteerId === v.id);
      const editable = canEdit(v, r);
      const perLang = new Map<LanguageCode, number>();
      if (editable) for (const g of pub) if (g.status === "going") { const l = langs.get(g.beneficiaryId!) ?? "fr"; perLang.set(l, (perLang.get(l) ?? 0) + 1); }
      return {
        id: r.id, kind: r.kind, title: r.title, description: r.description, place: r.place,
        date: localDate(r.startsAt, tz), startTime: localTime(r.startsAt, tz), endTime: r.endsAt ? localTime(r.endsAt, tz) : null,
        startsAt: r.startsAt.toISOString(), endsAt: r.endsAt?.toISOString() ?? null,
        volunteerSpots: r.volunteerSpots, public: r.public, publicSpots: r.publicSpots,
        languages: r.languages as LanguageCode[], skills: r.skills as Event["skills"],
        association: r.associationId ? (assocs.get(r.associationId) ?? null) : null,
        createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        going: going.length, waiting: waiting.length,
        publicGoing: pub.filter((g) => g.status === "going").length, publicWaiting: pub.filter((g) => g.status === "waitlist").length,
        publicLanguages: [...perLang].map(([language, count]) => ({ language, count })).sort((a, z) => z.count - a.count),
        myStatus: me?.status ?? null, myPosition: me ? (attendees.find((a) => a.volunteerId === v.id)?.position ?? null) : null,
        matchesMe: matches(v.id, r), canEdit: editable, attendees,
      };
    });
  }

  async function one(v: Volunteer, id: string): Promise<Event> {
    return (await toEvents(v, [await mustRow(id)]))[0]!;
  }

  function values(i: EventInput) {
    const startsAt = zonedDateTime(i.date, i.startTime, tz);
    return {
      kind: i.kind, title: i.title, description: i.description, place: i.place, startsAt,
      endsAt: i.endTime ? zonedDateTime(i.date, i.endTime, tz) : null,
      volunteerSpots: i.volunteerSpots, public: i.public, publicSpots: i.public ? i.publicSpots : null,
      languages: [...new Set(i.languages)], skills: [...new Set(i.skills)],
    };
  }

  // ------------------------------------------------------------------------------------- WhatsApp texts

  /** Title and description in `lang`: cached per event; the French text if the translation fails (still useful). */
  async function localized(r: EventRow, lang: LanguageCode, beneficiaryId: string | null): Promise<{ title: string; description: string | null }> {
    if (lang === "fr") return { title: r.title, description: r.description };
    const cached = r.translations[lang];
    if (cached) return cached;
    try {
      const tr = (text: string) => withUsageContext(beneficiaryId, () => llm.translateText({ text, from: "fr", to: lang }));
      const [title, description] = await Promise.all([tr(r.title), r.description ? tr(r.description) : Promise.resolve(null)]);
      const value = { title: title.trim(), description: description?.trim() ?? null };
      await db.update(events).set({ translations: sql`${events.translations} || ${JSON.stringify({ [lang]: value })}::jsonb` }).where(eq(events.id, r.id));
      return value;
    } catch (e) {
      console.error("[events] translation failed:", e instanceof Error ? e.message : String(e));
      return { title: r.title, description: r.description };
    }
  }

  /** "mardi 12 novembre · 14:00–16:00" in the person's language. */
  function when(r: EventRow, lang: LanguageCode, weekday = true): string {
    const start = formatTime(localTime(r.startsAt, tz), lang);
    const hours = r.endsAt ? `${start}–${formatTime(localTime(r.endsAt, tz), lang)}` : start;
    return `${formatDate(localDate(r.startsAt, tz), lang, { weekday })} · ${isolate(hours)}`;
  }

  /** The {summary} lines: title, date, place. Already bidi-isolated and RTL-safe. */
  async function summary(r: EventRow, lang: LanguageCode, beneficiaryId: string | null): Promise<string> {
    const { title } = await localized(r, lang, beneficiaryId);
    const lines = [`${EVENT_EMOJI[r.kind]} ${title}`, `📅 ${when(r, lang)}`];
    if (r.place) lines.push(`📍 ${isolate(r.place)}`);
    return lines.map((l) => (isRtl(lang) ? RLM + l : l)).join("\n");
  }

  async function notify(beneficiaryId: string, key: EventKey, r: EventRow, params: Record<string, string | number> = {}): Promise<void> {
    const b = await ben().get(beneficiaryId);
    if (!b || b.archivedAt) return;
    const lang = b.language;
    const body = eventText(lang, key, { ...params, summary: await summary(r, lang, beneficiaryId) });
    const dek = await ben().getDek(beneficiaryId);
    const [row] = await db.insert(messages).values({
      beneficiaryId, direction: "out", kind: "text", status: "queued",
      bodyEnc: crypto.encrypt(dek, `${body}\n\n${footerFor(deps, lang)}`),
      author: "system", chatState: "sent",
    }).returning({ id: messages.id });
    await jobs.send(JOBS.waSend, { kind: "chat", messageId: row!.id });
  }

  async function notifyPromoted(r: EventRow, promoted: RegRow[]): Promise<void> {
    for (const p of promoted) if (p.beneficiaryId) await notify(p.beneficiaryId, "events_promoted", r);
  }

  /** The detail message for one event (no action lines). */
  async function detail(r: EventRow, lang: LanguageCode, beneficiaryId: string | null): Promise<string> {
    const { title, description } = await localized(r, lang, beneficiaryId);
    const lines = [`${EVENT_EMOJI[r.kind]} *${title}*`, `📅 ${when(r, lang)}`];
    if (r.place) lines.push(`📍 ${isolate(r.place)}`);
    if (r.publicSpots !== null) {
      const left = Math.max(0, r.publicSpots - (await goingCount(db, r.id, "beneficiary")));
      if (left > 0) lines.push(eventText(lang, "events_spots_left", { n: left }));
    }
    const head = lines.map((l) => (isRtl(lang) ? RLM + l : l)).join("\n");
    return description ? `${head}\n\n${description}` : head;
  }

  // ------------------------------------------------------------------------------------------------ API

  return {
    summary,
    localized,

    async list(v: Volunteer, input: { scope: "upcoming" | "mine" | "past"; before?: string; limit: number }): Promise<Event[]> {
      const at = now();
      // Not over yet: started less than 12 h ago counts (the end filter is applied below), so today's maraude stays.
      const conds: (SQL | undefined)[] = [scopeWhere(v)];
      if (input.scope === "past") {
        conds.push(lt(events.startsAt, at), gte(events.startsAt, new Date(at.getTime() - PAST_DAYS * 24 * HOUR)));
      } else {
        conds.push(gte(events.startsAt, new Date(at.getTime() - 12 * HOUR)));
        if (input.before) conds.push(lt(events.startsAt, zonedDateTime(input.before, "00:00", tz)));
      }
      if (input.scope === "mine") {
        conds.push(isNull(events.cancelledAt), sql`exists (select 1 from ${eventRegistrations} where ${eventRegistrations.eventId} = ${events.id} and ${eventRegistrations.volunteerId} = ${v.id})`);
      }
      let rows = await db.select().from(events).where(and(...conds))
        .orderBy(input.scope === "past" ? desc(events.startsAt) : asc(events.startsAt)).limit(input.limit);
      if (input.scope !== "past") rows = rows.filter((r) => !isOver(r, at));
      return toEvents(v, rows);
    },

    async get(v: Volunteer, id: string): Promise<Event> {
      await visibleRow(v, id);
      return one(v, id);
    },

    async create(v: Volunteer, input: EventInput): Promise<Event> {
      const associationId = isGlobal(v) ? (input.associationId ?? null) : (v.association?.id ?? null);
      if (associationId && isGlobal(v)) {
        const [a] = await db.select({ id: associations.id }).from(associations).where(eq(associations.id, associationId)).limit(1);
        if (!a) throw new EventError("NOT_FOUND");
      }
      const vals = values(input);
      if (vals.startsAt.getTime() <= now().getTime()) throw new EventError("CONFLICT", "past");
      const [r] = await db.insert(events).values({ ...vals, associationId, createdBy: v.id, updatedBy: v.id }).returning();
      return one(v, r!.id);
    },

    async update(v: Volunteer, id: string, input: EventInput): Promise<Event> {
      const old = await editableRow(v, id);
      if (old.cancelledAt) throw new EventError("CONFLICT", "cancelled");
      const vals = values(input);
      const moved = old.startsAt.getTime() !== vals.startsAt.getTime() || (old.endsAt?.getTime() ?? null) !== (vals.endsAt?.getTime() ?? null) || old.place !== vals.place;
      const { row, promoted } = await db.transaction(async (tx) => {
        await tx.select({ id: events.id }).from(events).where(eq(events.id, id)).for("update");
        const textChanged = old.title !== vals.title || old.description !== vals.description;
        const [row] = await tx.update(events).set({ ...vals, ...(textChanged ? { translations: {} } : {}), updatedBy: v.id, updatedAt: now() }).where(eq(events.id, id)).returning();
        // A new time: the day-before reminder is due again.
        if (old.startsAt.getTime() !== vals.startsAt.getTime()) await tx.update(eventRegistrations).set({ remindedAt: null }).where(eq(eventRegistrations.eventId, id));
        // No longer public: beneficiaries' registrations go (they are told it is cancelled for them, below).
        const promoted = [...(await promote(tx, row!, "volunteer")), ...(row!.public ? await promote(tx, row!, "beneficiary") : [])];
        return { row: row!, promoted };
      });
      const registered = await db.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, id), isNotNull(eventRegistrations.beneficiaryId)));
      if (old.public && !row.public) {
        for (const g of registered) await notify(g.beneficiaryId!, "events_cancelled", old);
        await db.delete(eventRegistrations).where(and(eq(eventRegistrations.eventId, id), isNotNull(eventRegistrations.beneficiaryId)));
      } else if (moved && row.startsAt.getTime() > now().getTime()) {
        const promotedIds = new Set(promoted.map((p) => p.id));
        for (const g of registered) if (!promotedIds.has(g.id)) await notify(g.beneficiaryId!, "events_changed", row);
      }
      await notifyPromoted(row, promoted);
      return one(v, id);
    },

    async cancel(v: Volunteer, id: string): Promise<Event> {
      const r = await editableRow(v, id);
      if (r.cancelledAt) return one(v, id);
      const [row] = await db.update(events).set({ cancelledAt: now(), updatedBy: v.id, updatedAt: now() }).where(and(eq(events.id, id), isNull(events.cancelledAt))).returning();
      if (row && row.startsAt.getTime() > now().getTime()) {
        const registered = await db.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, id), isNotNull(eventRegistrations.beneficiaryId)));
        for (const g of registered) await notify(g.beneficiaryId!, "events_cancelled", row);
      }
      return one(v, id);
    },

    async join(v: Volunteer, id: string): Promise<Event> {
      await visibleRow(v, id);
      await register(id, { volunteerId: v.id });
      return one(v, id);
    },

    async leave(v: Volunteer, id: string): Promise<Event> {
      await visibleRow(v, id);
      const { promoted, row } = await unregister(id, eq(eventRegistrations.volunteerId, v.id));
      await notifyPromoted(row, promoted);
      return one(v, id);
    },

    async removeAttendee(v: Volunteer, id: string, volunteerId: string): Promise<Event> {
      await editableRow(v, id);
      const { removed, promoted, row } = await unregister(id, eq(eventRegistrations.volunteerId, volunteerId));
      if (!removed) throw new EventError("NOT_FOUND");
      await notifyPromoted(row, promoted);
      return one(v, id);
    },

    /** What a beneficiary sees for this event on WhatsApp (detail + the "register" options). */
    async preview(v: Volunteer, id: string, lang: LanguageCode): Promise<string> {
      const r = await visibleRow(v, id);
      return `${await detail(r, lang, null)}\n\n${eventText(lang, "events_actions_join")}`;
    },

    // ---------------------------------------------------------------------------------- WhatsApp side

    /** Public events offered on WhatsApp: upcoming, not cancelled, within WA_AHEAD_DAYS, soonest first. */
    async offerable(): Promise<EventRow[]> {
      const at = now();
      return db.select().from(events)
        .where(and(eq(events.public, true), isNull(events.cancelledAt), gt(events.startsAt, at), lt(events.startsAt, new Date(at.getTime() + WA_AHEAD_DAYS * 24 * HOUR))))
        .orderBy(asc(events.startsAt)).limit(WA_LIST_LIMIT);
    },

    /** Upcoming public events this person registered for (kept in the list even if beyond the offer window). */
    async registrationsOf(beneficiaryId: string): Promise<Map<string, RegRow>> {
      const rows = await db.select().from(eventRegistrations).where(eq(eventRegistrations.beneficiaryId, beneficiaryId));
      return new Map(rows.map((g) => [g.eventId, g]));
    },

    async publicRow(id: string): Promise<EventRow | null> {
      const [r] = await db.select().from(events).where(and(eq(events.id, id), eq(events.public, true))).limit(1);
      return r ?? null;
    },

    /** "N - title · date" line label (no number). */
    async listLabel(r: EventRow, lang: LanguageCode, beneficiaryId: string): Promise<string> {
      const { title } = await localized(r, lang, beneficiaryId);
      return `${EVENT_EMOJI[r.kind]} ${title} · ${formatDate(localDate(r.startsAt, tz), lang, { weekday: true })} ${isolate(formatTime(localTime(r.startsAt, tz), lang))}`;
    },

    /** The detail message and the options that fit this person's registration. */
    async detailFor(r: EventRow, lang: LanguageCode, beneficiaryId: string): Promise<{ text: string; state: "closed" | "join" | "waitlist" | "registered" | "waiting" }> {
      const head = await detail(r, lang, beneficiaryId);
      const [reg] = await db.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, r.id), eq(eventRegistrations.beneficiaryId, beneficiaryId))).limit(1);
      let state: "closed" | "join" | "waitlist" | "registered" | "waiting";
      let actions: string;
      if (reg?.status === "going") { state = "registered"; actions = eventText(lang, "events_actions_registered"); }
      else if (reg) { state = "waiting"; actions = eventText(lang, "events_actions_waiting", { n: (await positionOf(db, reg)) ?? 1 }); }
      else if (r.cancelledAt || r.startsAt.getTime() <= now().getTime()) { state = "closed"; actions = `${eventText(lang, "events_closed")}\n${eventText(lang, "events_back")}`; }
      else if (r.publicSpots !== null && (await goingCount(db, r.id, "beneficiary")) >= r.publicSpots) { state = "waitlist"; actions = eventText(lang, "events_actions_waitlist"); }
      else { state = "join"; actions = eventText(lang, "events_actions_join"); }
      return { text: `${head}\n\n${actions}`, state };
    },

    async registerBeneficiary(eventId: string, beneficiaryId: string): Promise<JoinResult | "closed"> {
      try {
        const { result, row } = await register(eventId, { beneficiaryId });
        if (result.status === "going") await notify(beneficiaryId, "events_registered", row);
        else await notify(beneficiaryId, "events_waitlisted", row, { n: result.position ?? 1 });
        return result;
      } catch (e) {
        if (e instanceof EventError) return "closed";
        throw e;
      }
    },

    async unregisterBeneficiary(eventId: string, beneficiaryId: string): Promise<boolean> {
      const { removed, promoted, row } = await unregister(eventId, eq(eventRegistrations.beneficiaryId, beneficiaryId));
      await notifyPromoted(row, promoted);
      return removed;
    },

    /** "Delete all my data": take every registration off (others move up). */
    async removeAllFor(beneficiaryId: string): Promise<void> {
      const rows = await db.select({ eventId: eventRegistrations.eventId }).from(eventRegistrations).where(eq(eventRegistrations.beneficiaryId, beneficiaryId));
      for (const g of rows) {
        const { promoted, row } = await unregister(g.eventId, eq(eventRegistrations.beneficiaryId, beneficiaryId));
        await notifyPromoted(row, promoted);
      }
    },

    /**
     * Every 15 min (events.dispatch): the day-before reminder to beneficiaries going to a public event, claimed row by
     * row (`reminded_at is null`) so it goes out exactly once. Volunteers have the .ics alarm and the Home card.
     */
    async dispatch(at: Date = now()): Promise<{ reminders: number }> {
      const due = await db.select({ reg: eventRegistrations, ev: events }).from(eventRegistrations)
        .innerJoin(events, eq(events.id, eventRegistrations.eventId))
        .where(and(
          isNotNull(eventRegistrations.beneficiaryId), eq(eventRegistrations.status, "going"), isNull(eventRegistrations.remindedAt),
          isNull(events.cancelledAt), eq(events.public, true), gt(events.startsAt, at), lte(events.startsAt, new Date(at.getTime() + REMINDER_BEFORE_MS)),
          // Registered in the last few hours before the start: they just got the confirmation, no reminder needed.
          lt(eventRegistrations.createdAt, sql`${events.startsAt} - interval '6 hours'`),
        ));
      let reminders = 0;
      for (const { reg, ev } of due) {
        const claimed = await db.update(eventRegistrations).set({ remindedAt: at })
          .where(and(eq(eventRegistrations.id, reg.id), isNull(eventRegistrations.remindedAt))).returning({ id: eventRegistrations.id });
        if (!claimed.length) continue;
        await notify(reg.beneficiaryId!, "events_reminder", ev);
        reminders++;
      }
      return { reminders };
    },

    /** Today's date in the association's timezone, and a day N days later (for "next 14 days"). */
    dayAfter: (days: number) => addDays(localDate(now(), tz), days),
  };
}
