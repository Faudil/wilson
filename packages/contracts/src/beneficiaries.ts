import { z } from "zod";
import { AvatarSchema, IdSchema, TimestampSchema } from "./common.js";
import { DocumentSchema } from "./documents.js";
import { LanguageSchema } from "./languages.js";
import { LetterSummarySchema } from "./letters.js";
import { WebAccountSchema } from "./me.js";

/** A person using the service (WhatsApp, or the web space). The phone number is never returned in clear to the back-office. */
export const BeneficiarySummarySchema = z.object({
  id: IdSchema,
  label: z.string(), // nickname if set, else masked phone
  avatar: AvatarSchema.nullable(),
  language: LanguageSchema,
  createdAt: TimestampSchema,
  lastMessageAt: TimestampSchema.nullable(),
  documentCount: z.number().int(),
  nextExpiry: z.iso.date().nullable(),
  /** Set for people who signed up on the web ("Mon espace") instead of WhatsApp; `label` is then their account number. */
  webAccount: WebAccountSchema.nullable().default(null),
});

export const BeneficiaryDetailSchema = BeneficiarySummarySchema.extend({
  documents: z.array(DocumentSchema),
  letters: z.array(LetterSummarySchema),
});

export const BeneficiaryAvatarInputSchema = z.object({ id: IdSchema, avatar: AvatarSchema });

/** What the team did in the last 7 days, for the thank-you on the home page. Counts only, no content. */
export const TeamWeekSchema = z.object({
  lettersExplained: z.number().int(),
  peopleHelped: z.number().int(),
  repliesSent: z.number().int(),
  /** First names of volunteers who reviewed a letter or replied this week, most active first (at most 5), without the caller. */
  helpers: z.array(z.string()),
  /** The caller's own count this week (letters approved + replies sent). */
  mine: z.number().int(),
});
export type TeamWeek = z.infer<typeof TeamWeekSchema>;
