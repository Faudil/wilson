import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";

export const DocumentTypeSchema = z.enum([
  "attestation_demande_asile", // ADA
  "recepisse", // récépissé de demande de titre
  "titre_de_sejour",
  "autorisation_provisoire_sejour", // APS
  "domiciliation",
  "passport",
  "identity_other",
  "health_insurance", // attestation AME / PUMa / carte vitale
  "caf_attestation",
  "convocation",
  "letter", // a letter saved from "Mon courrier"
  "other",
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const ExpirySourceSchema = z.enum(["detected", "entered_by_user", "entered_by_volunteer"]);

export const ReminderSchema = z.object({
  id: IdSchema,
  kind: z.enum(["d30", "d7"]),
  dueAt: TimestampSchema,
  status: z.enum(["scheduled", "sent", "cancelled", "failed"]),
  sentAt: TimestampSchema.nullable(),
});

export const DocumentSchema = z.object({
  id: IdSchema,
  beneficiaryId: IdSchema,
  type: DocumentTypeSchema,
  /** Free label (user or volunteer), e.g. "Récépissé 2e renouvellement". */
  label: z.string().max(120).nullable(),
  expiresAt: CalendarDateSchema.nullable(),
  expirySource: ExpirySourceSchema.nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  reminders: z.array(ReminderSchema),
});
export type DocumentDto = z.infer<typeof DocumentSchema>;

export const DocumentAnalysisSchema = z.object({
  promptVersion: z.string(),
  type: DocumentTypeSchema,
  expiresAt: CalendarDateSchema.nullable(),
  /** Verbatim text the date came from, e.g. "Valable jusqu'au 14/03/2027". */
  expirySourceQuote: z.string().max(300).nullable(),
  confidence: z.number().min(0).max(1),
});
export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

export const DocumentUpdateSchema = z.object({
  id: IdSchema,
  type: DocumentTypeSchema.optional(),
  label: z.string().max(120).nullable().optional(),
  expiresAt: CalendarDateSchema.nullable().optional(),
});

export const DeadlineRowSchema = z.object({
  documentId: IdSchema,
  beneficiaryId: IdSchema,
  beneficiaryLabel: z.string(),
  type: DocumentTypeSchema,
  expiresAt: CalendarDateSchema,
  daysLeft: z.number().int(),
});
