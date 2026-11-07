import { and, asc, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { ApiKey, LanguageCode, UsageBudget, UsageSummary, UsageTask, UsageTotals } from "@wilson/contracts";
import type { Config } from "../config.js";
import type { Crypto } from "../crypto/keys.js";
import type { Db } from "../db/client.js";
import { llmApiKeys, llmBudget, llmUsage } from "../db/schema.js";
import { costMicroUsd, type TokenCounts } from "../llm/pricing.js";
import { LlmError } from "../llm/provider.js";
import { addDays, localDate, zonedTime } from "../time.js";
import { currentBeneficiaryId } from "./context.js";

export interface UsageEvent {
  /** The admin-added key that paid for the call; null = server key. */
  keyId: string | null;
  task: UsageTask;
  model: string;
  language: LanguageCode | null;
  tokens: TokenCounts;
}

/** Which key to use for a call. apiKey null = the provider's default client (server key). */
export interface KeyChoice {
  keyId: string | null;
  apiKey: string | null;
}

/** What the LLM provider calls around each request. */
export interface UsageMeter {
  /**
   * Picks the key for the next call: the oldest active admin-added key with budget left, else the server key.
   * Throws BudgetReachedError (global hard stop) or NoKeyLeftError (every key used up and no server key).
   * `skip` = keys that just failed for this call.
   */
  beforeCall(task: UsageTask, skip?: ReadonlySet<string>): Promise<KeyChoice>;
  /** Stores one call. Never throws: a tracking failure must not break the answer to a person. */
  record(e: UsageEvent): Promise<void>;
  /** The API refused this key (invalid, no credit…): note it and skip the key for a while. Never throws. */
  keyFailed(keyId: string, message: string): Promise<void>;
}

export class BudgetReachedError extends LlmError {
  constructor() {
    super("Monthly Claude budget reached (hard stop is on in Usage settings)");
    this.name = "BudgetReachedError";
  }
}

export class NoKeyLeftError extends LlmError {
  constructor() {
    super("No Claude API key with budget left this month (see Usage > API keys)");
    this.name = "NoKeyLeftError";
  }
}

const WARNING_AT = 0.8;
const CACHE_MS = 30_000;
/** A key the API refused is not tried again for this long (the admin sees the error meanwhile). */
const KEY_COOLDOWN_MS = 30 * 60_000;

type Deps = { db: Db; crypto: Crypto; config: Pick<Config, "TIMEZONE" | "LLM_MODE" | "ANTHROPIC_API_KEY">; now: () => Date };

function createUsageService({ db, crypto, config, now }: Deps) {
  const tz = config.TIMEZONE;
  const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
  const nextMonth = (d: string) => {
    const [y, m] = d.split("-").map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  };
  const prevMonth = (d: string) => {
    const [y, m] = d.split("-").map(Number) as [number, number];
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  };
  const at = (date: string) => zonedTime(date, 0, tz);
  const inRange = (from: string, to: string) => and(gte(llmUsage.at, at(from)), lt(llmUsage.at, at(to)));

  const aggregates = {
    calls: count(),
    inputTokens: sql<string>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.cacheReadTokens} + ${llmUsage.cacheWriteTokens}), 0)`,
    outputTokens: sql<string>`coalesce(sum(${llmUsage.outputTokens}), 0)`,
    micro: sql<string>`coalesce(sum(${llmUsage.costMicroUsd}), 0)`,
    unpriced: sql<string>`count(*) filter (where ${llmUsage.costMicroUsd} is null)`,
  };
  const toTotals = (r: { calls: number | string; inputTokens: string; outputTokens: string; micro: string; unpriced: string } | undefined): UsageTotals => ({
    calls: Number(r?.calls ?? 0),
    inputTokens: Number(r?.inputTokens ?? 0),
    outputTokens: Number(r?.outputTokens ?? 0),
    costUsd: Number(r?.micro ?? 0) / 1e6,
    unpricedCalls: Number(r?.unpriced ?? 0),
  });

  async function totals(from: string, to: string): Promise<UsageTotals> {
    const [r] = await db.select(aggregates).from(llmUsage).where(inRange(from, to));
    return toTotals(r);
  }

  async function readBudget(): Promise<{ limitCents: number | null; hardStop: boolean }> {
    const [b] = await db.select().from(llmBudget).where(eq(llmBudget.id, 1));
    return { limitCents: b?.monthlyLimitCents ?? null, hardStop: b?.hardStop ?? false };
  }

  function budgetView(b: { limitCents: number | null; hardStop: boolean }, monthUsd: number): UsageBudget {
    if (b.limitCents === null) return { monthlyLimitUsd: null, hardStop: b.hardStop, state: "none", usedPercent: null };
    const limit = b.limitCents / 100;
    const share = limit > 0 ? monthUsd / limit : monthUsd > 0 ? Infinity : 0;
    const state = share >= 1 ? "over" : share >= WARNING_AT ? "warning" : "ok";
    return { monthlyLimitUsd: limit, hardStop: b.hardStop, state, usedPercent: Number.isFinite(share) ? Math.round(share * 1000) / 10 : 100 };
  }

  type KeyRow = typeof llmApiKeys.$inferSelect;
  // Month-to-date cost (total and per key) + budget + keys, cached briefly: the check before each call costs a few
  // queries every 30 s at most. Decrypted keys live only in this process's memory.
  let cache: {
    month: string; until: number; micro: number; perKey: Map<string, number>; limitCents: number | null; hardStop: boolean; keys: KeyRow[];
  } | null = null;
  const clearKeys = new Map<string, string>();

  async function perKeyMonth(from: string, to: string) {
    const rows = await db.select({ keyId: llmUsage.apiKeyId, calls: count(), micro: aggregates.micro }).from(llmUsage)
      .where(inRange(from, to)).groupBy(llmUsage.apiKeyId);
    return new Map(rows.map((r) => [r.keyId ?? "server", { calls: Number(r.calls), micro: Number(r.micro) }]));
  }

  async function loadCache() {
    const today = localDate(now(), tz);
    const month = today.slice(0, 7);
    if (cache && cache.month === month && cache.until > Date.now()) return cache;
    const per = await perKeyMonth(monthStart(today), nextMonth(today));
    const b = await readBudget();
    const keys = await db.select().from(llmApiKeys).orderBy(asc(llmApiKeys.createdAt));
    let micro = 0;
    for (const v of per.values()) micro += v.micro;
    cache = { month, until: Date.now() + CACHE_MS, micro, perKey: new Map([...per].map(([k, v]) => [k, v.micro])), limitCents: b.limitCents, hardStop: b.hardStop, keys };
    return cache;
  }

  const keyStatus = (k: KeyRow, usedMicro: number): ApiKey["status"] => {
    if (k.disabledAt) return "disabled";
    if (k.monthlyLimitCents !== null && usedMicro >= k.monthlyLimitCents * 10_000) return "exhausted";
    if (k.lastErrorAt && now().getTime() - k.lastErrorAt.getTime() < KEY_COOLDOWN_MS) return "error";
    return "active";
  };

  function clearKey(k: KeyRow): string {
    let v = clearKeys.get(k.id);
    if (!v) {
      v = crypto.decrypt(crypto.unwrapDek(k.wrappedDek), k.keyEnc).toString("utf8");
      clearKeys.set(k.id, v);
    }
    return v;
  }

  const meter: UsageMeter = {
    async beforeCall(_task, skip) {
      const c = await loadCache();
      if (c.hardStop && c.limitCents !== null && c.micro >= c.limitCents * 10_000) throw new BudgetReachedError();
      const usable = c.keys.find((k) => !skip?.has(k.id) && keyStatus(k, c.perKey.get(k.id) ?? 0) === "active");
      if (usable) return { keyId: usable.id, apiKey: clearKey(usable) };
      // Admin keys exist but none is usable, and the server has no key of its own: nothing left to call with.
      if (c.keys.length > 0 && !config.ANTHROPIC_API_KEY) throw new NoKeyLeftError();
      return { keyId: null, apiKey: null };
    },
    async record(e) {
      try {
        const costMicro = costMicroUsd(e.model, e.tokens);
        await db.insert(llmUsage).values({
          at: now(),
          task: e.task,
          model: e.model,
          language: e.language,
          beneficiaryId: currentBeneficiaryId(),
          apiKeyId: e.keyId,
          ...e.tokens,
          costMicroUsd: costMicro,
        });
        if (cache && costMicro) {
          cache.micro += costMicro;
          const k = e.keyId ?? "server";
          cache.perKey.set(k, (cache.perKey.get(k) ?? 0) + costMicro);
        }
      } catch (err) {
        console.error("[usage] could not record a Claude call:", err instanceof Error ? err.message : String(err));
      }
    },
    async keyFailed(keyId, message) {
      try {
        // Never store anything that could contain the key itself.
        const clean = message.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-…").slice(0, 300);
        await db.update(llmApiKeys).set({ lastError: clean, lastErrorAt: now() }).where(eq(llmApiKeys.id, keyId));
        cache = null;
        console.error(`[usage] Claude API key ${keyId} refused, trying the next one: ${clean}`);
      } catch (err) {
        console.error("[usage] could not mark a key as failed:", err instanceof Error ? err.message : String(err));
      }
    },
  };

  async function keyView(k: KeyRow): Promise<ApiKey> {
    const today = localDate(now(), tz);
    const per = await perKeyMonth(monthStart(today), nextMonth(today));
    return toKeyView(k, per.get(k.id));
  }
  function toKeyView(k: KeyRow, used: { calls: number; micro: number } | undefined): ApiKey {
    return {
      id: k.id,
      label: k.label,
      last4: k.keyLast4,
      monthlyLimitUsd: k.monthlyLimitCents === null ? null : k.monthlyLimitCents / 100,
      usedThisMonthUsd: (used?.micro ?? 0) / 1e6,
      callsThisMonth: used?.calls ?? 0,
      status: keyStatus(k, used?.micro ?? 0),
      lastError: k.lastError,
      lastErrorAt: k.lastErrorAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    };
  }
  const cents = (usd: number | null) => (usd === null ? null : Math.round(usd * 100));

  async function grouped<K extends string>(key: ReturnType<typeof sql<K>>, from: string, to: string) {
    const rows = await db.select({ key, ...aggregates }).from(llmUsage).where(inRange(from, to)).groupBy(key).orderBy(desc(aggregates.micro), desc(count()));
    return rows.map((r) => ({ key: r.key, ...toTotals(r) }));
  }

  return {
    meter,

    async summary(): Promise<UsageSummary> {
      const today = localDate(now(), tz);
      const mStart = monthStart(today);
      const mEnd = nextMonth(today);
      const tomorrow = addDays(today, 1);
      const [todayT, thisMonth, lastMonth] = await Promise.all([totals(today, tomorrow), totals(mStart, mEnd), totals(prevMonth(today), mStart)]);

      const from30 = addDays(today, -29);
      const dayKey = sql<string>`to_char(${llmUsage.at} at time zone ${tz}, 'YYYY-MM-DD')`;
      const dayRows = await db.select({ day: dayKey, calls: count(), micro: aggregates.micro }).from(llmUsage).where(inRange(from30, tomorrow)).groupBy(sql`1`);
      const byDay = new Map(dayRows.map((r) => [r.day, r]));
      const days = Array.from({ length: 30 }, (_, i) => {
        const date = addDays(from30, i);
        const r = byDay.get(date);
        return { date, calls: Number(r?.calls ?? 0), costUsd: Number(r?.micro ?? 0) / 1e6 };
      });

      const [byTask, byModel, byLanguage] = await Promise.all([
        grouped(sql<UsageTask>`${llmUsage.task}`, mStart, mEnd),
        grouped(sql<string>`${llmUsage.model}`, mStart, mEnd),
        grouped(sql<LanguageCode | "none">`coalesce(${llmUsage.language}::text, 'none')`, mStart, mEnd),
      ]);

      const [conv] = await db.select({ people: sql<string>`count(distinct ${llmUsage.beneficiaryId})`, micro: aggregates.micro })
        .from(llmUsage).where(and(inRange(mStart, mEnd), isNotNull(llmUsage.beneficiaryId)));
      const people = Number(conv?.people ?? 0);

      const dayOfMonth = Number(today.slice(8, 10));
      const daysInMonth = Number(addDays(mEnd, -1).slice(8, 10));

      return {
        month: today.slice(0, 7),
        today: todayT,
        thisMonth,
        lastMonth,
        projectedMonthUsd: (thisMonth.costUsd / dayOfMonth) * daysInMonth,
        days,
        byTask,
        byModel,
        byLanguage,
        perConversationUsd: people > 0 ? Number(conv!.micro) / 1e6 / people : null,
        budget: budgetView(await readBudget(), thisMonth.costUsd),
        fakeMode: config.LLM_MODE === "fake",
      };
    },

    async listKeys() {
      const today = localDate(now(), tz);
      const per = await perKeyMonth(monthStart(today), nextMonth(today));
      const keys = await db.select().from(llmApiKeys).orderBy(asc(llmApiKeys.createdAt));
      const server = per.get("server");
      return {
        keys: keys.map((k) => toKeyView(k, per.get(k.id))),
        serverKey: { configured: !!config.ANTHROPIC_API_KEY, usedThisMonthUsd: (server?.micro ?? 0) / 1e6, callsThisMonth: server?.calls ?? 0 },
      };
    },

    async addKey(input: { label: string; apiKey: string; monthlyLimitUsd: number | null }, volunteerId: string): Promise<ApiKey> {
      const { wrapped, dek } = crypto.newDek();
      const [k] = await db.insert(llmApiKeys).values({
        label: input.label,
        wrappedDek: wrapped,
        keyEnc: crypto.encrypt(dek, input.apiKey),
        keyLast4: input.apiKey.slice(-4),
        monthlyLimitCents: cents(input.monthlyLimitUsd),
        createdAt: now(),
        createdBy: volunteerId,
      }).returning();
      cache = null;
      return keyView(k!);
    },

    /** null when the key does not exist. Re-enabling or changing the limit also clears a past error. */
    async updateKey(input: { id: string; label?: string; monthlyLimitUsd?: number | null; disabled?: boolean }): Promise<ApiKey | null> {
      const set: Partial<KeyRow> = {};
      if (input.label !== undefined) set.label = input.label;
      if (input.monthlyLimitUsd !== undefined) set.monthlyLimitCents = cents(input.monthlyLimitUsd);
      if (input.disabled !== undefined) set.disabledAt = input.disabled ? now() : null;
      if (input.disabled === false || input.monthlyLimitUsd !== undefined) Object.assign(set, { lastError: null, lastErrorAt: null });
      const [k] = Object.keys(set).length
        ? await db.update(llmApiKeys).set(set).where(eq(llmApiKeys.id, input.id)).returning()
        : await db.select().from(llmApiKeys).where(eq(llmApiKeys.id, input.id));
      cache = null;
      return k ? keyView(k) : null;
    },

    async removeKey(id: string): Promise<boolean> {
      const r = await db.delete(llmApiKeys).where(eq(llmApiKeys.id, id)).returning({ id: llmApiKeys.id });
      clearKeys.delete(id);
      cache = null;
      return r.length > 0;
    },

    async setBudget(input: { monthlyLimitUsd: number | null; hardStop: boolean }, volunteerId: string): Promise<UsageBudget> {
      const values = {
        monthlyLimitCents: input.monthlyLimitUsd === null ? null : Math.round(input.monthlyLimitUsd * 100),
        hardStop: input.hardStop,
        updatedAt: now(),
        updatedBy: volunteerId,
      };
      await db.insert(llmBudget).values({ id: 1, ...values }).onConflictDoUpdate({ target: llmBudget.id, set: values });
      cache = null;
      const today = localDate(now(), tz);
      return budgetView(await readBudget(), (await totals(monthStart(today), nextMonth(today))).costUsd);
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;

const perDb = new WeakMap<object, UsageService>();
/** One usage service per database, so the provider's meter and the back-office share the budget cache. */
export function usageServiceFor(deps: Deps): UsageService {
  let s = perDb.get(deps.db);
  if (!s) {
    s = createUsageService(deps);
    perDb.set(deps.db, s);
  }
  return s;
}
