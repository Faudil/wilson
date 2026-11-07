import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * Announcements ("free legal clinic on Saturday") sent on WhatsApp to every person who opted in, each in their own
 * language. Written in French by a volunteer (`broadcasts.create`), approved and sent by someone else
 * (`broadcasts.approve`; four-eyes unless BROADCAST_FOUR_EYES=off). Inside WhatsApp's 24 h window the text is a free
 * service message; outside it, Meta only allows an approved template (marketing category, paid per message): the
 * person gets the short "announcement" template and the text itself when they tap "Read" or reply.
 */
export const BroadcastStatusSchema = z.enum(["draft", "sending", "sent", "cancelled"]);
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;

export const BroadcastInputSchema = z.object({
  textFr: z.string().trim().min(5).max(900),
  /** Only people with these languages; null = everyone who opted in. */
  languages: z.array(LanguageSchema).min(1).nullable().default(null),
});
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

/** What sending would cost now. Prices are estimates from WHATSAPP_PRICE_MARKETING_USD (check Meta's rate card). */
export const BroadcastEstimateSchema = z.object({
  recipients: z.number().int(),
  byLanguage: z.array(z.object({ language: LanguageSchema, count: z.number().int() })),
  /** Wrote to us in the last 24 h: plain message, free. */
  inWindow: z.number().int(),
  /** Template first (paid), then the text once they answer. */
  outsideWindow: z.number().int(),
  /** Estimated WhatsApp cost, US cents. */
  whatsappCostCents: z.number(),
  /** One Claude translation per language other than French. */
  translations: z.number().int(),
});
export type BroadcastEstimate = z.infer<typeof BroadcastEstimateSchema>;

export const BroadcastStatsSchema = z.object({
  /** Recipients created when sending started. */
  total: z.number().int(),
  sent: z.number().int(),
  /** Template sent, text waiting for the person to tap "Read" or reply. */
  awaitingReply: z.number().int(),
  failed: z.number().int(),
  /** Opted out or deleted their data before their turn. */
  skipped: z.number().int(),
});

export const BroadcastSchema = z.object({
  id: IdSchema,
  textFr: z.string(),
  languages: z.array(LanguageSchema).nullable(),
  status: BroadcastStatusSchema,
  createdAt: TimestampSchema,
  createdById: IdSchema.nullable(),
  createdByName: z.string().nullable(),
  approvedAt: TimestampSchema.nullable(),
  approvedByName: z.string().nullable(),
  /** Live estimate for a draft; the estimate taken at approval for the others. */
  estimate: BroadcastEstimateSchema,
  stats: BroadcastStatsSchema,
});
export type Broadcast = z.infer<typeof BroadcastSchema>;
