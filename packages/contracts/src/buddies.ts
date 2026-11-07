import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * French practice buddies: a beneficiary asks on WhatsApp (menu 7) to practise French, is matched with an approved
 * volunteer, and they meet or call once a week, with a reminder the day before.
 *
 * Safety rules, enforced on the server:
 * - only volunteers holding `buddies.be_buddy` can be matched, and the beneficiary must accept each proposal;
 * - contact goes through Wilson (messages are relayed); the beneficiary's number is shown to their buddy only after the
 *   beneficiary said yes on WhatsApp, only while the pairing is active, and every view is logged;
 * - either side can stop at any time, and either side can report a problem, which pauses the pairing at once until
 *   someone with `buddies.reports` looks at it.
 */

/** When the beneficiary is free (asked on WhatsApp, broad on purpose). */
export const BuddyWindowSchema = z.enum(["weekday_morning", "weekday_afternoon", "weekday_evening", "weekend"]);
export type BuddyWindow = z.infer<typeof BuddyWindowSchema>;

/** call = WhatsApp/phone call (needs the beneficiary's consent to share their number); meet = in person, public place. */
export const BuddyModeSchema = z.enum(["call", "meet"]);
export type BuddyMode = z.infer<typeof BuddyModeSchema>;
export const BuddyModePreferenceSchema = z.enum(["call", "meet", "either"]);
export type BuddyModePreference = z.infer<typeof BuddyModePreferenceSchema>;

/** ISO weekday (1 = Monday … 7 = Sunday) and wall-clock time in Europe/Paris. */
export const BuddyWeekdaySchema = z.number().int().min(1).max(7);
export const BuddyTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
export const BuddySlotSchema = z.object({ weekday: BuddyWeekdaySchema, time: BuddyTimeSchema });
export type BuddySlot = z.infer<typeof BuddySlotSchema>;

/** Which broad window a weekly slot falls in (shared by matching and the back-office). */
export function windowOfSlot(slot: BuddySlot): BuddyWindow {
  if (slot.weekday >= 6) return "weekend";
  const hour = Number(slot.time.slice(0, 2));
  return hour < 12 ? "weekday_morning" : hour < 17 ? "weekday_afternoon" : "weekday_evening";
}

/** A volunteer's buddy profile (their own; `buddies.be_buddy`). */
export const BuddyProfileSchema = z.object({
  /** false = not taking new buddies (existing pairings continue). */
  active: z.boolean(),
  /** Languages they can speak with a beneficiary besides French. */
  languages: z.array(LanguageSchema).max(10),
  slots: z.array(BuddySlotSchema).max(14),
  modes: z.array(BuddyModeSchema).min(1),
  maxBuddies: z.number().int().min(1).max(5),
  /** Where they can meet (public place or the association's premises). Shown to the beneficiary. No home addresses. */
  meetPlace: z.string().trim().max(120).nullable(),
});
export type BuddyProfile = z.infer<typeof BuddyProfileSchema>;

export const BuddyRequestStatusSchema = z.enum(["waiting", "matched", "cancelled"]);

/** A beneficiary's request, as volunteers see it: no name and no phone number, only what matching needs. */
export const BuddyRequestSchema = z.object({
  id: IdSchema,
  beneficiaryLabel: z.string(),
  language: LanguageSchema,
  windows: z.array(BuddyWindowSchema),
  mode: BuddyModePreferenceSchema,
  status: BuddyRequestStatusSchema,
  createdAt: TimestampSchema,
  /** A proposal is waiting for the beneficiary's answer. */
  proposed: z.boolean(),
});
export type BuddyRequest = z.infer<typeof BuddyRequestSchema>;

/** A volunteer who could take a request, best first (`buddies.manage`). */
export const BuddyCandidateSchema = z.object({
  volunteerId: IdSchema,
  name: z.string(),
  languages: z.array(LanguageSchema),
  /** Speaks the beneficiary's language (besides French). */
  sharedLanguage: z.boolean(),
  /** Their slots that fall in the beneficiary's windows. */
  matchingSlots: z.array(BuddySlotSchema),
  modes: z.array(BuddyModeSchema),
  freeSpots: z.number().int(),
  score: z.number(),
});
export type BuddyCandidate = z.infer<typeof BuddyCandidateSchema>;

export const BuddyMatchStatusSchema = z.enum([
  "proposed", // waiting for the beneficiary's yes
  "declined", // the beneficiary said no
  "active",
  "suspended", // a report was made: no reminders, no relayed messages until it is handled
  "ended",
]);
export type BuddyMatchStatus = z.infer<typeof BuddyMatchStatusSchema>;

export const BuddySessionSchema = z.object({
  id: IdSchema,
  startsAt: TimestampSchema,
  status: z.enum(["scheduled", "cancelled", "done"]),
  cancelledBy: z.enum(["beneficiary", "volunteer"]).nullable(),
});
export type BuddySession = z.infer<typeof BuddySessionSchema>;

export const BuddyMatchSchema = z.object({
  id: IdSchema,
  requestId: IdSchema,
  status: BuddyMatchStatusSchema,
  volunteer: z.object({ id: IdSchema, name: z.string() }),
  beneficiaryLabel: z.string(),
  beneficiaryLanguage: LanguageSchema,
  weekday: BuddyWeekdaySchema,
  time: BuddyTimeSchema,
  mode: BuddyModeSchema,
  place: z.string().nullable(),
  /** The beneficiary agreed on WhatsApp to share their number with this buddy. */
  contactShared: z.boolean(),
  createdAt: TimestampSchema,
  acceptedAt: TimestampSchema.nullable(),
  endedAt: TimestampSchema.nullable(),
  endedBy: z.enum(["beneficiary", "volunteer", "coordinator"]).nullable(),
  nextSession: BuddySessionSchema.nullable(),
  openReports: z.number().int(),
});
export type BuddyMatch = z.infer<typeof BuddyMatchSchema>;

export const BuddyMessageSchema = z.object({
  id: IdSchema,
  author: z.enum(["beneficiary", "volunteer"]),
  text: z.string(),
  at: TimestampSchema,
});
export type BuddyMessage = z.infer<typeof BuddyMessageSchema>;

/** `messages` is null when the caller may see the pairing but not what the two people wrote to each other. */
export const BuddyMatchDetailSchema = BuddyMatchSchema.extend({
  sessions: z.array(BuddySessionSchema),
  messages: z.array(BuddyMessageSchema).nullable(),
});
export type BuddyMatchDetail = z.infer<typeof BuddyMatchDetailSchema>;

export const BuddyProposeInputSchema = z.object({
  requestId: IdSchema,
  /** Omitted = the caller proposes themselves. Proposing someone else needs `buddies.manage`. */
  volunteerId: IdSchema.optional(),
  weekday: BuddyWeekdaySchema,
  time: BuddyTimeSchema,
  mode: BuddyModeSchema,
  place: z.string().trim().max(120).nullable().optional(),
});

export const BuddyReportSchema = z.object({
  id: IdSchema,
  matchId: IdSchema,
  by: z.enum(["beneficiary", "volunteer"]),
  volunteerName: z.string(),
  beneficiaryLabel: z.string(),
  text: z.string(),
  status: z.enum(["open", "closed"]),
  createdAt: TimestampSchema,
  resolution: z.enum(["resumed", "ended"]).nullable(),
  note: z.string().nullable(),
  handledByName: z.string().nullable(),
});
export type BuddyReport = z.infer<typeof BuddyReportSchema>;
