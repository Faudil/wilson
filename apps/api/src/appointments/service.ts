/**
 * Rendez-vous with a volunteer: accompaniment to an appointment, or a form-filling session (see contracts/appointments.ts).
 *
 * One model for both kinds:
 *   draft (being typed on WhatsApp) → open (waiting for a volunteer) → accepted (a volunteer holds it, time + meeting
 *   point known) → done; or cancelled (by the person or a manager) / expired (nobody accepted in time).
 * Form sessions booked on a published slot skip "open": the slot's volunteer holds them at once.
 *
 * Personal data stays minimal and encrypted: the city and the meeting point are under the person's DEK; volunteers
 * see the masked phone label only once they hold the appointment. Everything sent to the person goes through a chat
 * row (encrypted, visible in Conversations) so that, outside WhatsApp's 24 h window, it waits behind the opt-in
 * template like any other answer.
 */
import { DomainError } from "../errors.js";
import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  ACCOMPANIMENT_TOPICS, FORM_TOPICS, isRtl, type Appointment, type HelpKind, type HelpTopic, type LanguageCode, type Permission, type Slot, type Volunteer,
} from "@wilson/contracts";
import { formatDate, formatTime, isolate, menuOptionLabel, waText, type WaKey } from "@wilson/i18n";
import type { Deps } from "../deps.js";
import { beneficiaries, helpReminders, helpRequests, helpSlots, messages, volunteers } from "../db/schema.js";
import { JOBS } from "../jobs/names.js";
import { getServices } from "../services.js";
import { localDate, localTime } from "../time.js";
import { footerFor } from "../whatsapp/send.js";

type Row = typeof helpRequests.$inferSelect;
type Db = Deps["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const HOUR = 3_600_000;
const RLM = "‏";
/** Documents stay openable until this long after the end of the session (then the access is gone, even if not marked done). */
const DOCUMENTS_GRACE_MS = 24 * HOUR;
/** An accepted appointment is marked done automatically this long after its end. */
const AUTO_DONE_MS = 24 * HOUR;
/** Form requests without a time that nobody picked up are closed after this long. */
const OPEN_FORM_TTL_MS = 30 * 24 * HOUR;
/** Drafts abandoned half-typed on WhatsApp are deleted after this long. */
const DRAFT_TTL_MS = 24 * HOUR;
/** Slots must start at least this far ahead to be offered on WhatsApp. */
const SLOT_LEAD_MS = 2 * HOUR;
/** "mine" view: past appointments kept visible this long (to mark them done). */
const MINE_PAST_MS = 7 * 24 * HOUR;

export const SLOT_OFFER_LIMIT = 9; // + "0 - none of these" = 10 rows, WhatsApp's list maximum

export class AppointmentError extends DomainError {
  constructor(code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT", reason?: string) {
    super(code, reason ?? code);
    this.name = "AppointmentError";
  }
}

export const kindOf = (topic: HelpTopic): HelpKind => ((ACCOMPANIMENT_TOPICS as readonly string[]).includes(topic) ? "accompaniment" : "form_session");

/** Topic name in the person's language, taken from the menu they chose it in. */
export function topicName(topic: HelpTopic, lang: LanguageCode): string {
  const place = (ACCOMPANIMENT_TOPICS as readonly string[]).indexOf(topic);
  if (place >= 0) return menuOptionLabel(lang, "help_place_menu", place + 1);
  return menuOptionLabel(lang, "help_form_menu", (FORM_TOPICS as readonly string[]).indexOf(topic) + 1);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function createAppointmentsService(deps: Deps) {
  const { db, crypto, config, jobs } = deps;
  const ben = getServices(deps).beneficiaries;
  const tz = config.TIMEZONE;
  const now = () => deps.now();

  const enc = async (beneficiaryId: string, text: string | null) => (text ? crypto.encrypt(await ben.getDek(beneficiaryId), text) : null);
  const dec = async (beneficiaryId: string, b: Buffer | null) => (b ? crypto.decrypt(await ben.getDek(beneficiaryId), b).toString("utf8") : null);

  async function mustRow(id: string, tx: Pick<Db, "select"> = db): Promise<Row> {
    const [r] = await tx.select().from(helpRequests).where(eq(helpRequests.id, id)).limit(1);
    if (!r) throw new AppointmentError("NOT_FOUND");
    return r;
  }

  /** "Tuesday 12 November 2026 · 14:00" in the person's language. */
  function when(at: Date, lang: LanguageCode): string {
    return `${formatDate(localDate(at, tz), lang, { weekday: true })} · ${isolate(formatTime(localTime(at, tz), lang))}`;
  }

  /** The lines that replace {summary}: topic, date, place. Already bidi-isolated and RTL-safe. */
  async function summary(r: Row, lang: LanguageCode, place?: string | null): Promise<string> {
    const lines = [`📌 ${topicName(r.topic as HelpTopic, lang)}`];
    if (r.startsAt) lines.push(`📅 ${when(r.startsAt, lang)}`);
    const where = place !== undefined ? place : (await dec(r.beneficiaryId, r.meetingPointEnc)) ?? (await dec(r.beneficiaryId, r.cityEnc));
    if (where) lines.push(`📍 ${isolate(where)}`);
    return lines.map((l) => (isRtl(lang) ? RLM + l : l)).join("\n");
  }

  /** Catalog text with {summary} (and other params) filled. */
  async function text(lang: LanguageCode, key: WaKey, r: Row | null, params: Record<string, string> = {}, place?: string | null): Promise<string> {
    const t = waText(lang, key, params);
    return r && t.includes("{summary}") ? t.replace("{summary}", await summary(r, lang, place)) : t;
  }

  /**
   * Send a fixed text to the person as a chat row (+ footer). Outside the 24 h window the wa.send worker holds it
   * behind the opt-in template; it is released on their next message.
   */
  async function notify(beneficiaryId: string, body: string): Promise<void> {
    const b = await ben.get(beneficiaryId);
    if (!b || b.archivedAt) return;
    const dek = await ben.getDek(beneficiaryId);
    const [row] = await db.insert(messages).values({
      beneficiaryId, direction: "out", kind: "text", status: "queued",
      bodyEnc: crypto.encrypt(dek, `${body}\n\n${footerFor(deps, b.language)}`),
      author: "system", chatState: "sent",
    }).returning({ id: messages.id });
    await jobs.send(JOBS.waSend, { kind: "chat", messageId: row!.id });
  }

  async function languageOf(beneficiaryId: string): Promise<LanguageCode> {
    return (await ben.get(beneficiaryId))?.language ?? "fr";
  }

  async function volunteerName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [v] = await db.select({ name: volunteers.name }).from(volunteers).where(eq(volunteers.id, id)).limit(1);
    return v?.name ?? null;
  }

  async function scheduleReminders(tx: Tx, requestId: string, startsAt: Date): Promise<void> {
    await cancelReminders(tx, requestId);
    const rows = ([["d1", 24 * HOUR], ["h2", 2 * HOUR]] as const)
      .map(([kind, before]) => ({ requestId, kind, dueAt: new Date(startsAt.getTime() - before) }))
      .filter((r) => r.dueAt.getTime() > now().getTime());
    if (rows.length) await tx.insert(helpReminders).values(rows);
  }
  async function cancelReminders(tx: Pick<Db, "update">, requestId: string): Promise<void> {
    await tx.update(helpReminders).set({ status: "cancelled" }).where(and(eq(helpReminders.requestId, requestId), eq(helpReminders.status, "scheduled")));
  }

  /** Free the slot a form session was booked on, so someone else can book it. */
  async function freeSlot(tx: Pick<Db, "update">, r: Row): Promise<void> {
    if (r.slotId) await tx.update(helpSlots).set({ requestId: null }).where(and(eq(helpSlots.id, r.slotId), eq(helpSlots.requestId, r.id)));
  }

  /** Atomic status change: only from one of `from`. Returns the updated row, or null if someone changed it first. */
  async function transition(tx: Pick<Db, "update">, id: string, from: Row["status"][], patch: Partial<typeof helpRequests.$inferInsert>): Promise<Row | null> {
    const [r] = await tx.update(helpRequests).set(patch).where(and(eq(helpRequests.id, id), inArray(helpRequests.status, from))).returning();
    return r ?? null;
  }

  // ------------------------------------------------------------------------------------------ volunteer DTOs

  const canManage = (v: Volunteer) => v.permissions.includes("appointments.manage");
  const has = (v: Volunteer, p: Permission) => v.permissions.includes(p);

  function documentsOpen(r: Row, at: Date): boolean {
    if (r.kind !== "form_session" || r.status !== "accepted" || !r.documentsConsent || !r.startsAt) return false;
    return at.getTime() <= r.startsAt.getTime() + r.durationMin * 60_000 + DOCUMENTS_GRACE_MS;
  }

  async function toDtos(rows: Row[], v: Volunteer): Promise<Appointment[]> {
    if (!rows.length) return [];
    const bens = await db.select({ id: beneficiaries.id, language: beneficiaries.language }).from(beneficiaries).where(inArray(beneficiaries.id, [...new Set(rows.map((r) => r.beneficiaryId))]));
    const langs = new Map(bens.map((b) => [b.id, b.language]));
    const vIds = [...new Set(rows.flatMap((r) => (r.volunteerId ? [r.volunteerId] : [])))];
    const names = new Map<string, string>();
    if (vIds.length) for (const x of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, vIds))) names.set(x.id, x.name);
    const at = now();
    const out: Appointment[] = [];
    for (const r of rows) {
      const mine = r.volunteerId === v.id;
      const insider = mine || canManage(v);
      out.push({
        id: r.id,
        kind: r.kind as HelpKind,
        topic: r.topic as HelpTopic,
        status: r.status as Appointment["status"],
        startsAt: r.startsAt?.toISOString() ?? null,
        durationMin: r.durationMin,
        city: await dec(r.beneficiaryId, r.cityEnc),
        meetingPoint: await dec(r.beneficiaryId, r.meetingPointEnc),
        language: (langs.get(r.beneficiaryId) ?? "fr") as LanguageCode,
        createdAt: r.createdAt.toISOString(),
        mine,
        volunteerName: r.volunteerId ? (names.get(r.volunteerId) ?? null) : null,
        beneficiaryLabel: insider ? await ben.label(r.beneficiaryId) : null,
        beneficiaryId: insider ? r.beneficiaryId : null,
        documentsConsent: r.documentsConsent,
        canOpenDocuments: mine && has(v, "appointments.documents") && documentsOpen(r, at),
      });
    }
    return out;
  }
  const one = async (r: Row, v: Volunteer) => (await toDtos([r], v))[0]!;

  /** Archived people (asked to delete their data) never show up. */
  const visible = sql`not exists (select 1 from ${beneficiaries} b where b.id = ${helpRequests.beneficiaryId} and b.archived_at is not null)`;

  async function getOwn(beneficiaryId: string, id: string): Promise<Row | null> {
    const [r] = await db.select().from(helpRequests).where(and(eq(helpRequests.id, id), eq(helpRequests.beneficiaryId, beneficiaryId))).limit(1);
    return r ?? null;
  }

  return {
    // ---------------------------------------------------------------------------------------- WhatsApp side

    async createDraft(beneficiaryId: string, topic: HelpTopic): Promise<string> {
      // One draft at a time: a new request replaces a half-typed one.
      await db.delete(helpRequests).where(and(eq(helpRequests.beneficiaryId, beneficiaryId), eq(helpRequests.status, "draft")));
      const [r] = await db.insert(helpRequests).values({ beneficiaryId, topic, kind: kindOf(topic), status: "draft" }).returning({ id: helpRequests.id });
      return r!.id;
    },

    getOwn,

    async setDraftTime(id: string, startsAt: Date): Promise<void> {
      await db.update(helpRequests).set({ startsAt }).where(and(eq(helpRequests.id, id), eq(helpRequests.status, "draft")));
    },

    async setDraftCity(beneficiaryId: string, id: string, city: string | null): Promise<void> {
      await db.update(helpRequests).set({ cityEnc: await enc(beneficiaryId, city?.trim().slice(0, 80) || null) }).where(and(eq(helpRequests.id, id), eq(helpRequests.status, "draft")));
    },

    async discardDraft(id: string): Promise<void> {
      await db.delete(helpRequests).where(and(eq(helpRequests.id, id), eq(helpRequests.status, "draft")));
    },

    /** draft → open (accompaniment, or a form session nobody's slot was picked for). */
    async submit(id: string, opts: { documentsConsent?: boolean } = {}): Promise<boolean> {
      return !!(await transition(db, id, ["draft"], { status: "open", documentsConsent: opts.documentsConsent ?? false, createdAt: now() }));
    },

    /** Upcoming free slots offered on WhatsApp, soonest first. */
    async offerableSlots(): Promise<{ id: string; startsAt: Date; place: string }[]> {
      return db.select({ id: helpSlots.id, startsAt: helpSlots.startsAt, place: helpSlots.place }).from(helpSlots)
        .innerJoin(volunteers, eq(volunteers.id, helpSlots.volunteerId))
        .where(and(isNull(helpSlots.requestId), gt(helpSlots.startsAt, new Date(now().getTime() + SLOT_LEAD_MS)), isNull(volunteers.disabledAt)))
        .orderBy(asc(helpSlots.startsAt)).limit(SLOT_OFFER_LIMIT);
    },

    /**
     * Book a slot for a draft form session: claimed atomically (`request_id is null`), so two people never get the
     * same slot. "taken" when someone was faster.
     */
    async book(id: string, slotId: string, documentsConsent: boolean): Promise<"booked" | "taken"> {
      const booked = await db.transaction(async (tx) => {
        const [slot] = await tx.update(helpSlots).set({ requestId: id })
          .where(and(eq(helpSlots.id, slotId), isNull(helpSlots.requestId), gt(helpSlots.startsAt, now())))
          .returning();
        if (!slot) return null;
        const r = await transition(tx, id, ["draft"], {
          status: "accepted", slotId: slot.id, volunteerId: slot.volunteerId, startsAt: slot.startsAt, durationMin: slot.durationMin,
          documentsConsent, acceptedAt: now(), createdAt: now(),
        });
        if (!r) throw new AppointmentError("CONFLICT", "not_draft"); // rolls the slot claim back
        await tx.update(helpRequests).set({ meetingPointEnc: await enc(r.beneficiaryId, slot.place) }).where(eq(helpRequests.id, id));
        await scheduleReminders(tx, id, slot.startsAt);
        return r;
      });
      if (!booked) return "taken";
      const r = await mustRow(id);
      const lang = await languageOf(r.beneficiaryId);
      await notify(r.beneficiaryId, await text(lang, "help_accepted", r, { name: firstName((await volunteerName(r.volunteerId)) ?? "") }));
      return "booked";
    },

    /** The person's open and upcoming requests (WhatsApp "my appointments"), soonest first. */
    async listForBeneficiary(beneficiaryId: string): Promise<Row[]> {
      return db.select().from(helpRequests)
        .where(and(eq(helpRequests.beneficiaryId, beneficiaryId), inArray(helpRequests.status, ["open", "accepted"]),
          or(isNull(helpRequests.startsAt), gt(helpRequests.startsAt, now()))))
        .orderBy(sql`${helpRequests.startsAt} asc nulls last`).limit(9);
    },

    /** The person cancels from WhatsApp. The volunteer sees it as cancelled in their list. */
    async cancelByBeneficiary(beneficiaryId: string, id: string): Promise<boolean> {
      const r = await getOwn(beneficiaryId, id);
      if (!r) return false;
      return db.transaction(async (tx) => {
        const done = await transition(tx, id, ["open", "accepted"], { status: "cancelled", closedAt: now() });
        if (!done) return false;
        await cancelReminders(tx, id);
        await freeSlot(tx, r);
        return true;
      });
    },

    /** "Delete all my data": nothing stays open or scheduled. */
    async cancelAllFor(beneficiaryId: string): Promise<void> {
      const rows = await db.select().from(helpRequests).where(and(eq(helpRequests.beneficiaryId, beneficiaryId), inArray(helpRequests.status, ["draft", "open", "accepted"])));
      for (const r of rows) {
        await db.transaction(async (tx) => {
          await transition(tx, r.id, ["draft", "open", "accepted"], { status: "cancelled", closedAt: now() });
          await cancelReminders(tx, r.id);
          await freeSlot(tx, r);
        });
      }
    },

    summary,
    text,
    when,

    // ---------------------------------------------------------------------------------------- volunteer side

    async list(view: "open" | "mine" | "all", v: Volunteer): Promise<Appointment[]> {
      if (view === "all" && !canManage(v)) throw new AppointmentError("FORBIDDEN");
      const where =
        view === "open" ? and(eq(helpRequests.status, "open"), visible)
        : view === "mine" ? and(eq(helpRequests.volunteerId, v.id), ne(helpRequests.status, "draft"),
            or(isNull(helpRequests.startsAt), gte(helpRequests.startsAt, new Date(now().getTime() - MINE_PAST_MS))), visible)
        : and(ne(helpRequests.status, "draft"), gte(helpRequests.createdAt, new Date(now().getTime() - 90 * 24 * HOUR)));
      const rows = await db.select().from(helpRequests).where(where).orderBy(sql`${helpRequests.startsAt} asc nulls last`, asc(helpRequests.createdAt)).limit(200);
      return toDtos(rows, v);
    },

    async counts(v: Volunteer): Promise<{ open: number; mineSoon: number }> {
      const [o] = await db.select({ n: sql<number>`count(*)::int` }).from(helpRequests).where(and(eq(helpRequests.status, "open"), visible));
      const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(helpRequests).where(and(
        eq(helpRequests.volunteerId, v.id), eq(helpRequests.status, "accepted"),
        gte(helpRequests.startsAt, now()), lte(helpRequests.startsAt, new Date(now().getTime() + 7 * 24 * HOUR)),
      ));
      return { open: o?.n ?? 0, mineSoon: m?.n ?? 0 };
    },

    async accept(id: string, v: Volunteer, input: { meetingPoint: string; startsAt?: string }): Promise<Appointment> {
      const r0 = await mustRow(id);
      if (r0.status !== "open") throw new AppointmentError("CONFLICT", "taken");
      let startsAt = r0.startsAt;
      if (!startsAt) {
        // A form session without a time: the volunteer proposes one.
        if (!input.startsAt) throw new AppointmentError("CONFLICT", "time_required");
        startsAt = new Date(input.startsAt);
      }
      if (startsAt.getTime() <= now().getTime()) throw new AppointmentError("CONFLICT", "past");
      const r = await db.transaction(async (tx) => {
        const r = await transition(tx, id, ["open"], {
          status: "accepted", volunteerId: v.id, acceptedAt: now(), startsAt,
          meetingPointEnc: await enc(r0.beneficiaryId, input.meetingPoint.trim()),
        });
        if (!r) throw new AppointmentError("CONFLICT", "taken");
        await scheduleReminders(tx, id, startsAt);
        return r;
      });
      const lang = await languageOf(r.beneficiaryId);
      await notify(r.beneficiaryId, await text(lang, "help_accepted", r, { name: firstName(v.name) }));
      return one(r, v);
    },

    /** The holder gives it back (or a manager takes it off them): open again, the person is told. */
    async release(id: string, v: Volunteer): Promise<Appointment> {
      const r0 = await mustRow(id);
      if (r0.volunteerId !== v.id && !canManage(v)) throw new AppointmentError("FORBIDDEN");
      const r = await db.transaction(async (tx) => {
        const r = await transition(tx, id, ["accepted"], {
          status: "open", volunteerId: null, acceptedAt: null, meetingPointEnc: null, slotId: null,
          // A form session's time was the volunteer's (slot or proposal); an accompaniment's is the person's own.
          ...(r0.kind === "form_session" ? { startsAt: null } : {}),
        });
        if (!r) throw new AppointmentError("CONFLICT", "not_accepted");
        await cancelReminders(tx, id);
        await freeSlot(tx, r0);
        return r;
      });
      const lang = await languageOf(r.beneficiaryId);
      await notify(r.beneficiaryId, await text(lang, "help_volunteer_cancelled", r0, {}, (await dec(r0.beneficiaryId, r0.cityEnc)) ?? null));
      return one(r, v);
    },

    async complete(id: string, v: Volunteer): Promise<Appointment> {
      const r0 = await mustRow(id);
      if (r0.volunteerId !== v.id && !canManage(v)) throw new AppointmentError("FORBIDDEN");
      const r = await transition(db, id, ["accepted"], { status: "done", closedAt: now() });
      if (!r) throw new AppointmentError("CONFLICT", "not_accepted");
      await cancelReminders(db, id);
      return one(r, v);
    },

    async cancel(id: string, v: Volunteer): Promise<Appointment> {
      const r0 = await mustRow(id);
      const r = await db.transaction(async (tx) => {
        const r = await transition(tx, id, ["open", "accepted"], { status: "cancelled", closedAt: now() });
        if (!r) throw new AppointmentError("CONFLICT", "closed");
        await cancelReminders(tx, id);
        await freeSlot(tx, r0);
        return r;
      });
      const lang = await languageOf(r.beneficiaryId);
      await notify(r.beneficiaryId, await text(lang, "help_cancelled_by_us", r0));
      return one(r, v);
    },

    /**
     * The guard for opening the person's documents: holder of an accepted form session, the person said yes, and the
     * session is not long over. Throws FORBIDDEN otherwise (no detail: the caller learns nothing about the person).
     */
    async documentsGuard(id: string, v: Volunteer): Promise<Row> {
      const r = await mustRow(id);
      if (r.volunteerId !== v.id || !documentsOpen(r, now())) throw new AppointmentError("FORBIDDEN");
      return r;
    },

    // ---------------------------------------------------------------------------------------- slots

    async slots(scope: "mine" | "all", v: Volunteer): Promise<Slot[]> {
      if (scope === "all" && !canManage(v)) throw new AppointmentError("FORBIDDEN");
      const rows = await db.select({ s: helpSlots, name: volunteers.name }).from(helpSlots)
        .innerJoin(volunteers, eq(volunteers.id, helpSlots.volunteerId))
        .where(and(gt(helpSlots.startsAt, new Date(now().getTime() - 24 * HOUR)), scope === "mine" ? eq(helpSlots.volunteerId, v.id) : undefined))
        .orderBy(asc(helpSlots.startsAt)).limit(200);
      return rows.map(({ s, name }) => ({
        id: s.id, startsAt: s.startsAt.toISOString(), durationMin: s.durationMin, place: s.place, volunteerName: name,
        mine: s.volunteerId === v.id, booked: !!s.requestId, requestId: s.volunteerId === v.id || canManage(v) ? s.requestId : null,
      }));
    },

    async addSlot(v: Volunteer, input: { startsAt: string; durationMin: number; place: string }): Promise<Slot> {
      const startsAt = new Date(input.startsAt);
      if (startsAt.getTime() <= now().getTime()) throw new AppointmentError("CONFLICT", "past");
      const [s] = await db.insert(helpSlots).values({ volunteerId: v.id, startsAt, durationMin: input.durationMin, place: input.place.trim() }).returning();
      return { id: s!.id, startsAt: s!.startsAt.toISOString(), durationMin: s!.durationMin, place: s!.place, volunteerName: v.name, mine: true, booked: false, requestId: null };
    },

    async removeSlot(id: string, v: Volunteer): Promise<void> {
      const [s] = await db.select().from(helpSlots).where(eq(helpSlots.id, id)).limit(1);
      if (!s) throw new AppointmentError("NOT_FOUND");
      if (s.volunteerId !== v.id && !canManage(v)) throw new AppointmentError("FORBIDDEN");
      // A booked slot is an appointment now: give it back (release) instead, so the person is told.
      const gone = await db.delete(helpSlots).where(and(eq(helpSlots.id, id), isNull(helpSlots.requestId))).returning({ id: helpSlots.id });
      if (!gone.length) throw new AppointmentError("CONFLICT", "booked");
    },

    // ---------------------------------------------------------------------------------------- cron

    /**
     * Every 15 min (help.dispatch): reminders that are due, open requests whose time passed (expired, the person is
     * told), accepted ones long over (done, which also ends document access), abandoned drafts.
     */
    async dispatch(at: Date = now()): Promise<{ reminders: number; expired: number }> {
      let sent = 0;
      const due = await db.select({ rem: helpReminders, req: helpRequests }).from(helpReminders)
        .innerJoin(helpRequests, eq(helpRequests.id, helpReminders.requestId))
        .where(and(eq(helpReminders.status, "scheduled"), lte(helpReminders.dueAt, at)));
      for (const { rem, req } of due) {
        if (req.status !== "accepted" || !req.startsAt || req.startsAt.getTime() <= at.getTime()) {
          await db.update(helpReminders).set({ status: "cancelled" }).where(and(eq(helpReminders.id, rem.id), eq(helpReminders.status, "scheduled")));
          continue;
        }
        const claimed = await db.update(helpReminders).set({ status: "sent", sentAt: at })
          .where(and(eq(helpReminders.id, rem.id), eq(helpReminders.status, "scheduled"))).returning({ id: helpReminders.id });
        if (!claimed.length) continue; // another dispatcher got it
        const lang = await languageOf(req.beneficiaryId);
        await notify(req.beneficiaryId, await text(lang, "help_reminder", req, { name: firstName((await volunteerName(req.volunteerId)) ?? "") }));
        sent++;
      }

      let expired = 0;
      const stale = await db.select().from(helpRequests).where(and(eq(helpRequests.status, "open"), or(
        lte(helpRequests.startsAt, at),
        and(isNull(helpRequests.startsAt), lte(helpRequests.createdAt, new Date(at.getTime() - OPEN_FORM_TTL_MS))),
      )));
      for (const r of stale) {
        if (!(await transition(db, r.id, ["open"], { status: "expired", closedAt: at }))) continue;
        expired++;
        await notify(r.beneficiaryId, await text(await languageOf(r.beneficiaryId), "help_expired", r));
      }

      await db.update(helpRequests).set({ status: "done", closedAt: at }).where(and(
        eq(helpRequests.status, "accepted"),
        lte(sql`${helpRequests.startsAt} + make_interval(mins => ${helpRequests.durationMin})`, new Date(at.getTime() - AUTO_DONE_MS)),
      ));
      await db.delete(helpRequests).where(and(eq(helpRequests.status, "draft"), lte(helpRequests.createdAt, new Date(at.getTime() - DRAFT_TTL_MS))));
      return { reminders: sent, expired };
    },
  };
}

export type AppointmentsService = ReturnType<typeof createAppointmentsService>;

const cache = new WeakMap<object, AppointmentsService>();
export function getAppointments(deps: Deps): AppointmentsService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createAppointmentsService(deps)));
  return s;
}
