import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";
import { ClockTimeSchema } from "./places.js";
import { VolunteerSkillSchema } from "./skills.js";

/**
 * The team side: what the association tells its volunteers (news), and volunteers asking each other for backup.
 * About volunteers and the association's organisation only: never write a beneficiary's name or situation here.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

// ---------------------------------------------------------------- news

export const NewsInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(4000),
  /**
   * Who reads it: null = every volunteer (global admins only), else one association. Association admins may leave it
   * out: their own association is used.
   */
  associationId: IdSchema.nullable().optional(),
  /** Shown first until unpinned. */
  pinned: z.boolean().default(false),
  /** Also e-mail it to the readers (only when e-mail is set up on the server; at creation only). */
  email: z.boolean().default(false),
});
export type NewsInput = z.infer<typeof NewsInputSchema>;

export const NewsUpdateSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(4000),
  pinned: z.boolean(),
});

export const NewsPostSchema = z.object({
  id: IdSchema,
  title: z.string(),
  body: z.string(),
  pinned: z.boolean(),
  /** null = every volunteer. */
  association: z.object({ id: IdSchema, name: z.string() }).nullable(),
  authorName: z.string().nullable(),
  createdAt: TimestampSchema,
  /** Set when the text was edited after posting. */
  editedAt: TimestampSchema.nullable(),
  /** The caller has read it. */
  read: z.boolean(),
  /** The caller may edit, pin or remove it (author, or someone who could have posted it). */
  canEdit: z.boolean(),
  /** For the people who can edit it: how many of the readers have opened it. null for the others. */
  reads: z.object({ seen: z.number().int().nonnegative(), audience: z.number().int().nonnegative() }).nullable(),
  emailedAt: TimestampSchema.nullable(),
});
export type NewsPost = z.infer<typeof NewsPostSchema>;

// ---------------------------------------------------------------- calls for backup

export const BACKUP_STATUSES = ["open", "covered", "cancelled"] as const;
export const BackupStatusSchema = z.enum(BACKUP_STATUSES);
export type BackupStatus = z.infer<typeof BackupStatusSchema>;

export const BackupInputSchema = z.object({
  /** "Arabic speaker for an OFII appointment", "Someone to hold the Tuesday permanence". */
  title: z.string().trim().min(3).max(120),
  details: optionalText(1000),
  /** The day help is needed (Europe/Paris). The call disappears the day after. */
  neededOn: CalendarDateSchema,
  startsAt: ClockTimeSchema.nullable().optional().transform((v) => v ?? null),
  /** Public place or the association's premises (never a person's address). */
  place: optionalText(200),
  /** Languages that would help (besides French). */
  languages: z.array(LanguageSchema).max(10).default([]).transform((l) => [...new Set(l)]),
  skills: z.array(VolunteerSkillSchema).max(10).default([]).transform((s) => [...new Set(s)]),
  /** How many people are needed. */
  needed: z.number().int().min(1).max(20).default(1),
  /** Also show it to the volunteers of every other association (default: one's own association only). */
  openToAll: z.boolean().default(false),
});
export type BackupInput = z.infer<typeof BackupInputSchema>;

export const BackupOfferSchema = z.object({
  volunteerId: IdSchema,
  name: z.string(),
  /** "I can from 10:30", "I speak Arabic and Dari". */
  note: z.string().nullable(),
  at: TimestampSchema,
});

export const BackupCallSchema = z.object({
  id: IdSchema,
  title: z.string(),
  details: z.string().nullable(),
  neededOn: CalendarDateSchema,
  startsAt: z.string().nullable(),
  place: z.string().nullable(),
  languages: z.array(LanguageSchema),
  skills: z.array(VolunteerSkillSchema),
  needed: z.number().int(),
  openToAll: z.boolean(),
  status: BackupStatusSchema,
  association: z.object({ id: IdSchema, name: z.string() }).nullable(),
  authorId: IdSchema.nullable(),
  authorName: z.string().nullable(),
  createdAt: TimestampSchema,
  /** The caller's own call. */
  mine: z.boolean(),
  /** The caller's profile matches a language or skill asked for. */
  forMe: z.boolean(),
  /** The caller offered to help. */
  offered: z.boolean(),
  /** Number of people who offered. */
  offerCount: z.number().int().nonnegative(),
  /** Who offered, with their note: only for the author and the people who can close it. */
  offers: z.array(BackupOfferSchema).nullable(),
  /** The caller may mark it covered or cancel it. */
  canClose: z.boolean(),
});
export type BackupCall = z.infer<typeof BackupCallSchema>;
