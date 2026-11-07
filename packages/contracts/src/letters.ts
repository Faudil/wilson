import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";
import { LetterSourceRefSchema } from "./knowledge.js";
import { LanguageSchema } from "./languages.js";
import { LETTER_TYPES } from "./values.js";

export const LetterTypeSchema = z.enum(LETTER_TYPES);
export type LetterType = z.infer<typeof LetterTypeSchema>;

export const UrgencySchema = z.enum(["low", "medium", "high"]);

export const DeadlineKindSchema = z.enum([
  "reply", // send a document / answer
  "appointment", // be present somewhere
  "appeal", // recours — legal deadline, orient to a jurist, never advise
  "payment",
  "other",
]);

/** Text fields of an analysis, written in ONE language. Produced twice: French (for the reviewer) and the user's language. */
export const LetterTextSchema = z.object({
  /** What this letter is, 1–2 short sentences. */
  title: z.string().min(1).max(300),
  /** Plain-language explanation, no legal advice. */
  summary: z.string().min(1).max(1500),
  /** What the person is expected to do, as short imperative steps. */
  actions: z.array(z.string().min(1).max(400)).max(6),
  /** Who to turn to and why (association, lawyer, the issuing office…). Always ≥ 1. */
  orientation: z.array(z.string().min(1).max(400)).min(1).max(4),
});
export type LetterText = z.infer<typeof LetterTextSchema>;

/** Exact JSON the LLM must return (see /prompts/letter-analysis). Language-neutral facts live once; prose lives per language. */
export const LetterAnalysisSchema = z.object({
  promptVersion: z.string(),
  isOfficialLetter: z.boolean(),
  letterType: LetterTypeSchema,
  issuer: z.string().max(200).nullable(),
  /** Reference numbers copied verbatim (n° étranger, n° allocataire, AGDREF…). Shown to the reviewer only. */
  references: z.array(z.string().max(100)).max(5),
  letterDate: CalendarDateSchema.nullable(),
  deadline: z
    .object({
      date: CalendarDateSchema,
      kind: DeadlineKindSchema,
      /** true if the date is printed in the letter; false if computed ("sous 15 jours") — reviewer must check. */
      explicit: z.boolean(),
      /** Verbatim French quote the date was taken from, for the reviewer. */
      sourceQuote: z.string().max(300),
    })
    .nullable(),
  urgency: UrgencySchema,
  /** 0–1 self-reported confidence; < 0.6 is flagged in the queue. */
  confidence: z.number().min(0).max(1),
  /** Things the reviewer must know (blurry, page missing, looks like OQTF…). French. */
  reviewerWarnings: z.array(z.string().max(300)).max(5),
  fr: LetterTextSchema,
  target: LetterTextSchema,
  /** Set by the orientation step (RAG): knowledge entries the orientation lines are based on. Not produced by the analysis prompt. */
  sources: z.array(LetterSourceRefSchema).max(8).optional(),
});
export type LetterAnalysis = z.infer<typeof LetterAnalysisSchema>;

export const LetterStatusSchema = z.enum([
  "received", // photo stored, analysis job queued
  "analyzing",
  "pending_review",
  "approved", // validated, send job queued
  "sent",
  "rejected", // AI draft discarded; user got the "a volunteer will contact you" message
  "failed", // analysis failed after retries; shown in queue as needing a human
]);
export type LetterStatus = z.infer<typeof LetterStatusSchema>;

export const LetterSummarySchema = z.object({
  id: IdSchema,
  beneficiaryId: IdSchema,
  beneficiaryLabel: z.string(), // masked phone, e.g. "+33 6 •• •• •4 21"
  language: LanguageSchema,
  status: LetterStatusSchema,
  letterType: LetterTypeSchema.nullable(),
  urgency: UrgencySchema.nullable(),
  deadline: CalendarDateSchema.nullable(),
  lowConfidence: z.boolean(),
  receivedAt: TimestampSchema,
});
export type LetterSummary = z.infer<typeof LetterSummarySchema>;

export const LetterDetailSchema = LetterSummarySchema.extend({
  analysis: LetterAnalysisSchema.nullable(),
  /** The exact WhatsApp text that will be sent, rendered from `analysis.target` + fixed footer. */
  outgoingText: z.string().nullable(),
  /** Same message rendered from `analysis.fr`, so a French-speaking volunteer can check it. */
  outgoingTextFr: z.string().nullable(),
  /** Second message, sent only if the person asks for more ("3 - More explanation"): summary + who can help. */
  outgoingDetailsText: z.string().nullable(),
  outgoingDetailsTextFr: z.string().nullable(),
  hasPhoto: z.boolean(),
  /** True when the reviewer edited the French prose: on approve, `target` is regenerated from `fr` by the LLM before sending. */
  frEdited: z.boolean(),
  history: z.array(
    z.object({
      at: TimestampSchema,
      volunteerName: z.string().nullable(),
      action: z.enum(["analyzed", "edited", "retranslated", "approved", "rejected", "sent", "failed"]),
      note: z.string().nullable(),
    }),
  ),
});
export type LetterDetail = z.infer<typeof LetterDetailSchema>;

export const LetterEditSchema = z.object({
  id: IdSchema,
  /** Reviewer can fix facts… */
  letterType: LetterTypeSchema.optional(),
  deadline: LetterAnalysisSchema.shape.deadline.optional(),
  urgency: UrgencySchema.optional(),
  /** …and prose in either language. Editing `fr` sets `frEdited`; the translation is redone automatically on approve. */
  fr: LetterTextSchema.optional(),
  target: LetterTextSchema.optional(),
});
