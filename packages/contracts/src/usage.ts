import { z } from "zod";
import { CalendarDateSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * Claude API usage, as shown to admins. Every number comes from the `usage` block the API returns on each call;
 * cost is an estimate from the public per-token price (USD, the currency Anthropic bills in).
 * No personal data: task, model, language and token counts only.
 */

/** What a call was for. One value per LlmProvider step (= prompt name). */
export const UsageTaskSchema = z.enum([
  "letter-analysis",
  "letter-translate",
  "letter-orientation",
  "document-analysis",
  "language-detect",
  "chat-plan",
  "chat-reply",
  "chat-translate",
]);
export type UsageTask = z.infer<typeof UsageTaskSchema>;

export const UsageTotalsSchema = z.object({
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Estimated cost in USD. Calls to a model with no known price count 0 here and in `unpricedCalls`. */
  costUsd: z.number(),
  unpricedCalls: z.number().int(),
});
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

export const UsageRowSchema = UsageTotalsSchema.extend({ key: z.string() });

/** ok < 80 % of the monthly limit ≤ warning < 100 % ≤ over. `none` = no limit set. */
export const BudgetStateSchema = z.enum(["none", "ok", "warning", "over"]);
export type BudgetState = z.infer<typeof BudgetStateSchema>;

export const UsageBudgetSchema = z.object({
  /** Monthly limit in USD; null = no limit. */
  monthlyLimitUsd: z.number().nullable(),
  /** When the limit is reached: true = stop calling Claude (chat questions go to volunteers, letters wait as "failed"). */
  hardStop: z.boolean(),
  state: BudgetStateSchema,
  /** Month-to-date share of the limit, 0–100+ (null without a limit). */
  usedPercent: z.number().nullable(),
});
export type UsageBudget = z.infer<typeof UsageBudgetSchema>;

export const UsageSetBudgetSchema = z.object({
  monthlyLimitUsd: z.number().min(0).max(100_000).nullable(),
  hardStop: z.boolean(),
});

export const UsageSummarySchema = z.object({
  /** Calendar month shown, `YYYY-MM` (association time zone). */
  month: z.string(),
  today: UsageTotalsSchema,
  thisMonth: UsageTotalsSchema,
  lastMonth: UsageTotalsSchema,
  /** Month-end projection at the current daily pace (USD). */
  projectedMonthUsd: z.number(),
  /** One row per day of the last 30 days, oldest first (days without calls included, at 0). */
  days: z.array(z.object({ date: CalendarDateSchema, calls: z.number().int(), costUsd: z.number() })),
  /** This month, by task / model / language, most expensive first. */
  byTask: z.array(UsageRowSchema.extend({ key: UsageTaskSchema })),
  byModel: z.array(UsageRowSchema),
  byLanguage: z.array(UsageRowSchema.extend({ key: z.union([LanguageSchema, z.literal("none")]) })),
  /** Average cost of one conversation this month (calls tied to a person, divided by the number of people). */
  perConversationUsd: z.number().nullable(),
  budget: UsageBudgetSchema,
  /** True when LLM_MODE=fake: nothing is recorded (no real calls). */
  fakeMode: z.boolean(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** A Claude API key added from the back-office. The key itself is never sent back, only its last 4 characters. */
export const ApiKeyStatusSchema = z.enum(["active", "exhausted", "error", "disabled"]);
export const ApiKeySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  last4: z.string(),
  monthlyLimitUsd: z.number().nullable(),
  usedThisMonthUsd: z.number(),
  callsThisMonth: z.number().int(),
  /** active = used for new calls · exhausted = its monthly limit is reached · error = the API refused it recently (skipped for 30 min) · disabled = turned off by an admin. */
  status: ApiKeyStatusSchema,
  lastError: z.string().nullable(),
  lastErrorAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyListSchema = z.object({
  /** Order of use: the first active key with budget left pays for the next call. */
  keys: z.array(ApiKeySchema),
  /** The key from the server configuration (ANTHROPIC_API_KEY), used after all the keys above. */
  serverKey: z.object({ configured: z.boolean(), usedThisMonthUsd: z.number(), callsThisMonth: z.number().int() }),
});

export const ApiKeyAddSchema = z.object({
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(20).max(300).regex(/^sk-ant-[A-Za-z0-9_-]+$/, "not a Claude API key"),
  monthlyLimitUsd: z.number().min(0).max(100_000).nullable(),
});
export const ApiKeyUpdateSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(80).optional(),
  monthlyLimitUsd: z.number().min(0).max(100_000).nullable().optional(),
  disabled: z.boolean().optional(),
});
