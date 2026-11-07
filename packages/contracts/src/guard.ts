import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * WhatsApp flood protection (see apps/api/src/whatsapp/guard.ts).
 * none: normal. quarantined: the number flooded us (or wrote first during a global flood); its messages are not
 * processed and nothing reaches the LLM until a volunteer releases or blocks it. blocked: every message is dropped.
 */
export const GuardStatusSchema = z.enum(["none", "quarantined", "blocked"]);
export type GuardStatus = z.infer<typeof GuardStatusSchema>;

/** flood: this number sent too much. global_flood: new number during a wave of messages. manual: a volunteer did it. */
export const GuardReasonSchema = z.enum(["flood", "global_flood", "manual"]);
export type GuardReason = z.infer<typeof GuardReasonSchema>;

export const HeldNumberSchema = z.object({
  beneficiaryId: IdSchema,
  /** Masked phone number, like everywhere else in the back-office. */
  label: z.string(),
  language: LanguageSchema,
  status: GuardStatusSchema.exclude(["none"]),
  reason: GuardReasonSchema,
  since: TimestampSchema,
  /** Messages stored from this number (nothing is stored once it is held). */
  totalMessages: z.number().int().nonnegative(),
  /** Last message received, in the person's language (text only, truncated). Viewing the list is logged. */
  lastText: z.string().nullable(),
  /** First contact more than a day before it was held: probably someone we already help, not a throwaway number. */
  knownBefore: z.boolean(),
});
export type HeldNumber = z.infer<typeof HeldNumberSchema>;

export const HeldNumbersSchema = z.object({
  items: z.array(HeldNumberSchema),
  /** True while the global inbound rate is above its limit: first messages from new numbers are held. */
  floodMode: z.boolean(),
});
