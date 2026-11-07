import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { beneficiaries, llmApiKeys, llmUsage } from "../src/db/schema.js";
import { AnthropicProvider, type AnthropicLike } from "../src/llm/anthropic.js";
import { costMicroUsd, priceFor } from "../src/llm/pricing.js";
import { withUsageContext } from "../src/usage/context.js";
import { BudgetReachedError, NoKeyLeftError, type UsageEvent, type UsageMeter } from "../src/usage/service.js";
import { createVolunteer, makeClient, makeTestDeps, type TestCtx } from "./helpers.js";

const tokens = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });

describe("pricing", () => {
  it("estimates cost per call in micro-USD from the public price list", () => {
    // Opus 5.5: $4 in / $20 out per million tokens
    expect(costMicroUsd("claude-opus-5-5", tokens(1000, 500))).toBe(1000 * 4 + 500 * 20);
    expect(costMicroUsd("claude-sonnet-5-5", tokens(1000, 500))).toBe(1000 * 2 + 500 * 10);
    expect(costMicroUsd("claude-haiku-5-5", tokens(1000, 500))).toBe(Math.round(1000 * 0.1 + 500 * 0.5));
  });
  it("applies Haiku 5.5's long-prompt tier above 100K prompt tokens", () => {
    expect(costMicroUsd("claude-haiku-5-5", tokens(200_000, 1000))).toBe(200_000 * 0.5 + 1000 * 2.5);
  });
  it("matches dated snapshots and platform prefixes, and returns null for unknown models", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual(priceFor("claude-haiku-4-5"));
    expect(priceFor("anthropic.claude-opus-5-5")).toEqual(priceFor("claude-opus-5-5"));
    expect(priceFor("claude-opus-5-5")).not.toEqual(priceFor("claude-opus-5"));
    expect(costMicroUsd("some-other-model", tokens(10, 10))).toBeNull();
  });
});

describe("AnthropicProvider usage metering (mocked SDK)", () => {
  const recorder = () => {
    const events: UsageEvent[] = [];
    let blocked = false;
    const meter: UsageMeter = {
      async beforeCall() {
        if (blocked) throw new BudgetReachedError();
        return { keyId: null, apiKey: null };
      },
      async record(e) {
        events.push(e);
      },
      async keyFailed() {},
    };
    return { meter, events, block: () => (blocked = true) };
  };
  const client = (replies: string[]) =>
    ({
      messages: {
        async create(p: { model: string }) {
          return { model: p.model, stop_reason: "end_turn", content: [{ type: "text", text: replies.shift() ?? "" }], usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    }) as unknown as AnthropicLike;

  it("records task, model, language and tokens for every call, repair retries included", async () => {
    const r = recorder();
    const llm = new AnthropicProvider({ model: "claude-opus-5-5", client: client(["not json", '{"intent":"info","frenchQuery":"caf","needsHuman":false}', "ሰላም", "Bonjour"]), meter: r.meter });
    await llm.planChat({ history: [{ role: "beneficiary", text: "سلام" }], language: "ps" });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toEqual({ keyId: null, task: "chat-plan", model: "claude-opus-5-5", language: "ps", tokens: tokens(120, 30) });

    await llm.translateText({ text: "Bonjour", from: "fr", to: "ti" });
    await llm.translateText({ text: "ሰላም", from: "ti", to: "fr" });
    expect(r.events.slice(2).map((e) => [e.task, e.language])).toEqual([["chat-translate", "ti"], ["chat-translate", "ti"]]);
  });

  it("does not call the API once the budget hard stop is reached", async () => {
    const r = recorder();
    let called = 0;
    const c = { messages: { async create() { called++; throw new Error("should not be called"); } } } as unknown as AnthropicLike;
    r.block();
    const llm = new AnthropicProvider({ model: "claude-opus-5-5", client: c, meter: r.meter });
    await expect(llm.translateText({ text: "Bonjour", from: "fr", to: "so" })).rejects.toBeInstanceOf(BudgetReachedError);
    expect(called).toBe(0);
  });
});

describe("usage service + rpc", () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await makeTestDeps({ now: "2026-11-07T10:00:00Z" });
  });
  afterAll(() => t.close());

  it("aggregates calls by day, month, task, model and language; admins only", async () => {
    const { meter } = t.services.usage;
    const [b] = await t.deps.db.insert(beneficiaries).values({ waIdHash: "h-usage", waIdEnc: Buffer.from("x"), waIdLast2: "00", language: "ps" }).returning();
    await withUsageContext(b!.id, async () => {
      await meter.record({ keyId: null, task: "chat-plan", model: "claude-opus-5-5", language: "ps", tokens: tokens(1000, 100) }); // 6000 µ$
      await meter.record({ keyId: null, task: "chat-reply", model: "claude-opus-5-5", language: "ps", tokens: tokens(2000, 500) }); // 18000 µ$
    });
    await meter.record({ keyId: null, task: "language-detect", model: "mystery-model", language: null, tokens: tokens(50, 5) });
    // last month (Paris time): 31 Oct 23:30 UTC = 1 Nov 00:30 Paris → this month; 31 Oct 22:00 UTC = 23:00 Paris → last month
    t.clock.set("2026-10-31T22:00:00Z");
    await meter.record({ keyId: null, task: "letter-analysis", model: "claude-opus-5-5", language: "am", tokens: tokens(5000, 1000) });
    t.clock.set("2026-10-31T23:30:00Z");
    await meter.record({ keyId: null, task: "document-analysis", model: "claude-opus-5-5", language: null, tokens: tokens(1000, 0) }); // 4000 µ$
    t.clock.set("2026-11-07T10:00:00Z");

    const rows = await t.deps.db.select().from(llmUsage).where(eq(llmUsage.task, "chat-plan"));
    expect(rows[0]).toMatchObject({ beneficiaryId: b!.id, costMicroUsd: 6000, inputTokens: 1000, outputTokens: 100 });

    const volunteer = await createVolunteer(t.deps);
    const vc = makeClient(t.deps).client;
    await vc.auth.login({ email: volunteer.email, password: volunteer.password });
    await expect(vc.usage.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: admin.email, password: admin.password });
    const s = await client.usage.summary();
    expect(s.month).toBe("2026-11");
    expect(s.today).toMatchObject({ calls: 3, costUsd: 0.024, unpricedCalls: 1 });
    expect(s.thisMonth).toMatchObject({ calls: 4, costUsd: 0.028 });
    expect(s.lastMonth).toMatchObject({ calls: 1, costUsd: 0.04 });
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1)).toEqual({ date: "2026-11-07", calls: 3, costUsd: 0.024 });
    expect(s.days.find((d) => d.date === "2026-11-01")).toEqual({ date: "2026-11-01", calls: 1, costUsd: 0.004 });
    expect(s.byTask[0]).toMatchObject({ key: "chat-reply", calls: 1, costUsd: 0.018 });
    expect(s.byLanguage.map((r) => r.key)).toEqual(["ps", "none"]);
    expect(s.byModel.map((r) => r.key)).toEqual(["claude-opus-5-5", "mystery-model"]);
    expect(s.perConversationUsd).toBe(0.024);
    expect(s.budget.state).toBe("none");
  });

  it("warns at 80 % of the monthly budget and stops calls when hard stop is on", async () => {
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: admin.email, password: admin.password });
    // month so far: $0.028
    expect(await client.usage.setBudget({ monthlyLimitUsd: 0.03, hardStop: false })).toMatchObject({ state: "warning", usedPercent: 93.3 });
    await t.services.usage.meter.beforeCall("chat-reply"); // no hard stop: allowed
    expect(await client.usage.setBudget({ monthlyLimitUsd: 0.02, hardStop: true })).toMatchObject({ state: "over", hardStop: true });
    await expect(t.services.usage.meter.beforeCall("chat-reply")).rejects.toBeInstanceOf(BudgetReachedError);
    expect((await client.usage.summary()).budget).toMatchObject({ monthlyLimitUsd: 0.02, state: "over" });
    await client.usage.setBudget({ monthlyLimitUsd: null, hardStop: true });
    await t.services.usage.meter.beforeCall("chat-reply");
  });
});

describe("several API keys with a monthly budget each", () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await makeTestDeps({ now: "2026-11-07T10:00:00Z" });
  });
  afterAll(() => t.close());

  const KEY_A = "sk-ant-api03-donorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1111";
  const KEY_B = "sk-ant-api03-donorBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2222";
  /** Fake API per key: `refuse` keys answer 401, others reply and report 1000 in / 100 out tokens ($0.006 on Opus 5.5). */
  const used: string[] = [];
  const refuse = new Set<string>();
  const clientForKey = (apiKey: string) =>
    ({
      messages: {
        async create(p: { model: string }) {
          if (refuse.has(apiKey)) throw Object.assign(new Error(`401 invalid x-api-key ${apiKey}`), { status: 401 });
          used.push(apiKey);
          return { model: p.model, stop_reason: "end_turn", content: [{ type: "text", text: "Bonjour" }], usage: { input_tokens: 1000, output_tokens: 100 } };
        },
      },
    }) as unknown as AnthropicLike;
  const llm = () => new AnthropicProvider({ model: "claude-opus-5-5", meter: t.services.usage.meter, clientForKey });
  const ask = () => llm().translateText({ text: "سلام", from: "fa", to: "fr" });

  it("stores keys encrypted, shows only the last 4 characters, and admins only", async () => {
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: admin.email, password: admin.password });
    const a = await client.usage.addKey({ label: "Fondation A", apiKey: KEY_A, monthlyLimitUsd: 0.01 });
    expect(a).toMatchObject({ label: "Fondation A", last4: "1111", monthlyLimitUsd: 0.01, status: "active", usedThisMonthUsd: 0 });
    expect(JSON.stringify(a)).not.toContain(KEY_A);
    await client.usage.addKey({ label: "Don B", apiKey: KEY_B, monthlyLimitUsd: null });
    const [row] = await t.deps.db.select().from(llmApiKeys).where(eq(llmApiKeys.id, a.id));
    expect(row!.keyEnc.toString("latin1")).not.toContain("donorAAAA");
    const list = await client.usage.listKeys();
    expect(list.keys.map((k) => k.label)).toEqual(["Fondation A", "Don B"]);
    expect(list.serverKey.configured).toBe(false);
    expect(JSON.stringify(list)).not.toContain("sk-ant-api03");
    await expect(client.usage.addKey({ label: "x", apiKey: "not-a-key-but-long-enough", monthlyLimitUsd: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const volunteer = await createVolunteer(t.deps);
    const vc = makeClient(t.deps).client;
    await vc.auth.login({ email: volunteer.email, password: volunteer.password });
    await expect(vc.usage.listKeys()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses the first key until its monthly limit, then the next one; a refused key is skipped", async () => {
    await ask(); // A: $0.006
    await ask(); // A: $0.012 ≥ $0.01 → exhausted
    await ask(); // B
    expect(used).toEqual([KEY_A, KEY_A, KEY_B]);
    const rows = await t.deps.db.select({ k: llmUsage.apiKeyId }).from(llmUsage);
    expect(new Set(rows.map((r) => r.k)).size).toBe(2);

    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: admin.email, password: admin.password });
    let list = await client.usage.listKeys();
    expect(list.keys.map((k) => [k.label, k.status, k.callsThisMonth])).toEqual([["Fondation A", "exhausted", 2], ["Don B", "active", 1]]);

    // B is revoked by its owner: the API refuses it → noted (without the key), and with no key left the call fails cleanly.
    refuse.add(KEY_B);
    await expect(ask()).rejects.toBeInstanceOf(NoKeyLeftError);
    list = await client.usage.listKeys();
    const b = list.keys.find((k) => k.label === "Don B")!;
    expect(b.status).toBe("error");
    expect(b.lastError).toContain("401");
    expect(b.lastError).not.toContain("donorBBBB");

    // Raising A's limit brings it back at once.
    const a = list.keys.find((k) => k.label === "Fondation A")!;
    expect(await client.usage.updateKey({ id: a.id, monthlyLimitUsd: 1 })).toMatchObject({ status: "active", monthlyLimitUsd: 1 });
    await ask();
    expect(used.at(-1)).toBe(KEY_A);

    // Disabled → skipped; removed → gone, its past calls still counted in the totals.
    await client.usage.updateKey({ id: a.id, disabled: true });
    await expect(ask()).rejects.toBeInstanceOf(NoKeyLeftError);
    await client.usage.removeKey({ id: a.id });
    await client.usage.removeKey({ id: b.id });
    expect((await client.usage.listKeys()).keys).toEqual([]);
    expect((await client.usage.summary()).thisMonth.calls).toBe(4);
    await expect(client.usage.removeKey({ id: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
