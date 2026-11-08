import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { DocumentSchema } from "./documents.js";
import { LanguageSchema } from "./languages.js";
import { LetterSummarySchema } from "./letters.js";

/** A person using the WhatsApp service. The phone number is never returned in clear to the back-office. */
export const BeneficiarySummarySchema = z.object({
  id: IdSchema,
  label: z.string(), // masked phone
  language: LanguageSchema,
  createdAt: TimestampSchema,
  lastMessageAt: TimestampSchema.nullable(),
  documentCount: z.number().int(),
  nextExpiry: z.iso.date().nullable(),
  /** Optional first name or nickname volunteers gave the person (encrypted at rest, removed with their data). */
  nickname: z.string().nullable().default(null),
});

export const NicknameSchema = z.string().trim().max(40);

export const BeneficiaryDetailSchema = BeneficiarySummarySchema.extend({
  documents: z.array(DocumentSchema),
  letters: z.array(LetterSummarySchema),
});
