import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";
import { ClockTimeSchema } from "./places.js";
import { EVENT_KINDS, VOLUNTEER_SKILLS } from "./values.js";

/**
 * Agenda: events of the association (a maraude, a team meeting, a training, a workshop…) that volunteers sign up for.
 * An event belongs to one association (only its members see it) or to everyone (associationId null).
 * A "public" event is also offered to beneficiaries on WhatsApp (menu 8 → 4), translated into their language; they
 * register by replying with its number and get a reminder the day before. Volunteers never see who they are, only
 * how many registered and in which languages.
 * Both sides can have a number of places: once it is full, new sign-ups go on a waiting list and move up, in order,
 * when someone takes their name off.
 */
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;
export const EventSkillSchema = z.enum(VOLUNTEER_SKILLS);

export const EventRegistrationStatusSchema = z.enum(["going", "waitlist"]);
export type EventRegistrationStatus = z.infer<typeof EventRegistrationStatusSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const spots = z.number().int().min(1).max(500).nullable().optional().transform((v) => v ?? null);

export const EventInputSchema = z.object({
  kind: EventKindSchema,
  /** French, e.g. "Maraude gare de l'Est". */
  title: z.string().trim().min(2).max(120),
  /** French: what happens, what to bring. Translated for beneficiaries when the event is public. */
  description: optionalText(1000),
  /** Meeting place / address (shown as typed, never translated). */
  place: optionalText(200),
  date: CalendarDateSchema,
  startTime: ClockTimeSchema,
  /** Same day, after startTime; null = no set end. */
  endTime: ClockTimeSchema.nullable().optional().transform((v) => v ?? null),
  /** Places for volunteers; null = no limit. */
  volunteerSpots: spots,
  /** Offered to beneficiaries on WhatsApp. */
  public: z.boolean().default(false),
  /** Places for beneficiaries (public events); null = no limit. */
  publicSpots: spots,
  /** Wanted on the team (shown, and highlighted to the volunteers who have them). */
  languages: z.array(LanguageSchema).max(10).default([]),
  skills: z.array(EventSkillSchema).max(10).default([]),
  /**
   * Who sees it. Global admins choose (null = every association); everyone else creates in their own association
   * (or for everyone when they have none). Ignored on update.
   */
  associationId: IdSchema.nullable().optional(),
}).refine((e) => !e.endTime || e.endTime > e.startTime, { message: "endTime before startTime", path: ["endTime"] });
export type EventInput = z.infer<typeof EventInputSchema>;

export const EventAttendeeSchema = z.object({
  volunteerId: IdSchema,
  name: z.string(),
  status: EventRegistrationStatusSchema,
  /** Waiting list position (1 = next to move up); null when going. */
  position: z.number().int().nullable(),
  /** Has one of the wanted languages / skills. */
  matches: z.boolean(),
  createdAt: TimestampSchema,
});
export type EventAttendee = z.infer<typeof EventAttendeeSchema>;

export const EventSchema = z.object({
  id: IdSchema,
  kind: EventKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  place: z.string().nullable(),
  /** Paris wall clock, as typed. */
  date: CalendarDateSchema,
  startTime: z.string(),
  endTime: z.string().nullable(),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema.nullable(),
  volunteerSpots: z.number().int().nullable(),
  public: z.boolean(),
  publicSpots: z.number().int().nullable(),
  languages: z.array(LanguageSchema),
  skills: z.array(EventSkillSchema),
  association: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdByName: z.string().nullable(),
  cancelledAt: TimestampSchema.nullable(),
  /** Volunteers going / on the waiting list. */
  going: z.number().int(),
  waiting: z.number().int(),
  /** Beneficiaries registered on WhatsApp (public events): going / waiting, and going per language. */
  publicGoing: z.number().int(),
  publicWaiting: z.number().int(),
  /** Only for those who may edit the event (organiser, events.manage); empty otherwise. */
  publicLanguages: z.array(z.object({ language: LanguageSchema, count: z.number().int() })),
  /** The caller's own sign-up. */
  myStatus: EventRegistrationStatusSchema.nullable(),
  myPosition: z.number().int().nullable(),
  /** The caller has one of the wanted languages or skills. */
  matchesMe: z.boolean(),
  /** The caller may edit or cancel it and remove people. */
  canEdit: z.boolean(),
  /** Volunteers signed up (going first, then the waiting list in order). */
  attendees: z.array(EventAttendeeSchema),
});
export type Event = z.infer<typeof EventSchema>;

export const EventListInputSchema = z.object({
  /** upcoming: not over yet (cancelled ones included, flagged); mine: upcoming I signed up for; past: last 90 days. */
  scope: z.enum(["upcoming", "mine", "past"]).default("upcoming"),
  /** Only events starting before this day (exclusive), e.g. the Home card's next 14 days. */
  before: CalendarDateSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
