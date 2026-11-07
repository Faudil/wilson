import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { DocumentSchema } from "./documents.js";
import { LanguageSchema } from "./languages.js";
import { HELP_KINDS, HELP_STATUSES, HELP_TOPICS } from "./values.js";

/**
 * Rendez-vous with a volunteer, asked for on WhatsApp (menu 8):
 * - accompaniment: the person gives the date, time and city of an appointment (préfecture, OFII, hospital…), and a
 *   volunteer accepts to come along, with a meeting point;
 * - form_session: the person books a slot a volunteer published (or asks for one) to fill in a CAF, ANEF or AME form
 *   together, and says whether the volunteer may open the documents saved in Wilson for that session.
 * One model for both: a request (open → accepted → done, or cancelled / expired), WhatsApp reminders the day before and
 * 2 hours before for the person, and the volunteer's own list + calendar file (.ics with alarms) on their side.
 * Volunteers never get the phone number: only the masked label, and only once they hold the appointment.
 */
export const HelpKindSchema = z.enum(HELP_KINDS);
export type HelpKind = z.infer<typeof HelpKindSchema>;
export const HelpTopicSchema = z.enum(HELP_TOPICS);
export type HelpTopic = z.infer<typeof HelpTopicSchema>;
export const HelpStatusSchema = z.enum(HELP_STATUSES);
export type HelpStatus = z.infer<typeof HelpStatusSchema>;

export const AppointmentSchema = z.object({
  id: IdSchema,
  kind: HelpKindSchema,
  topic: HelpTopicSchema,
  status: HelpStatusSchema,
  /** null = form session still waiting for a volunteer to propose a time. */
  startsAt: TimestampSchema.nullable(),
  durationMin: z.number().int().positive(),
  /** City the person typed (accompaniment), so volunteers nearby can see it. */
  city: z.string().nullable(),
  /** Set by the volunteer who accepted (or the slot's place). */
  meetingPoint: z.string().nullable(),
  /** Language the person speaks: volunteers who speak it can step in. */
  language: LanguageSchema,
  createdAt: TimestampSchema,
  /** Held by the current volunteer. */
  mine: z.boolean(),
  volunteerName: z.string().nullable(),
  /** Masked phone label; only for the volunteer holding it and for `appointments.manage`. */
  beneficiaryLabel: z.string().nullable(),
  /** Only for the volunteer holding it and for `appointments.manage` (link to the conversation). */
  beneficiaryId: IdSchema.nullable(),
  /** The person agreed that the volunteer opens their saved documents for this session. */
  documentsConsent: z.boolean(),
  /** consent + held by me + `appointments.documents` + session not over: `appointments.documents` will answer. */
  canOpenDocuments: z.boolean(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const AppointmentListInputSchema = z.object({
  /** open = waiting for a volunteer · mine = I hold it (upcoming and the last 7 days) · all = everything (`appointments.manage`). */
  view: z.enum(["open", "mine", "all"]).default("open"),
});

export const AcceptInputSchema = z.object({
  id: IdSchema,
  /** Where to meet ("devant l'entrée principale", "au local de l'association"…). Sent to the person. No personal data. */
  meetingPoint: z.string().trim().min(2).max(160),
  /** Required for a form session that has no time yet; ignored otherwise (the appointment time is the person's). */
  startsAt: TimestampSchema.optional(),
});

export const SlotSchema = z.object({
  id: IdSchema,
  startsAt: TimestampSchema,
  durationMin: z.number().int().positive(),
  place: z.string(),
  volunteerName: z.string(),
  mine: z.boolean(),
  /** Booked by someone (the request id, for the volunteer who owns the slot or a manager). */
  booked: z.boolean(),
  requestId: IdSchema.nullable(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const SlotCreateSchema = z.object({
  startsAt: TimestampSchema,
  durationMin: z.number().int().min(15).max(240).default(60),
  /** Where the session happens: the association's address, a France services office, "par téléphone"… */
  place: z.string().trim().min(2).max(160),
});

export const AppointmentDocumentsSchema = z.array(DocumentSchema);
