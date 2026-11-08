import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { DocumentSchema } from "./documents.js";
import { LanguageSchema } from "./languages.js";
import { LetterSummarySchema } from "./letters.js";
import { WebAccountSchema } from "./me.js";

/** A person using the service (WhatsApp, or the web space). The phone number is never returned in clear to the back-office. */
export const BeneficiarySummarySchema = z.object({
  id: IdSchema,
  label: z.string(), // masked phone
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
