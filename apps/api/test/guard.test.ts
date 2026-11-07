import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { waText } from "@wilson/i18n";
import { beneficiaries, messages } from "../src/db/schema.js";
import { FloodGuard } from "../src/whatsapp/guard.js";
import { registerWaDeps } from "../src/whatsapp/context.js";
import { handleWhatsAppWebhook } from "../src/whatsapp/webhook.js";
import { createVolunteer, makeClient, testConfig } from "./helpers.js";
import { fakeHttp, makeWa, type WaCtx } from "./wa.helpers.js";

const LIMITS = {
  WA_RATE_PER_MINUTE: "3", WA_RATE_PER_HOUR: "1000", WA_FILES_PER_DAY: "2",
  WA_FLOOD_PER_MINUTE: "6", WA_FLOOD_PER_HOUR: "1000", WA_FLOOD_PER_DAY: "1000",
  WA_GLOBAL_PER_MINUTE: "1000", WA_GLOBAL_PER_HOUR: "100000",
};

let t: WaCtx;
beforeAll(async () => {
  t = await makeWa({ config: LIMITS, now: "2026-11-07T10:00:00Z" });
  registerWaDeps(t.wdeps);
});
afterAll(() => t.close());

const row = async (phone: string) => {
  const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, t.deps.crypto.lookupHash(phone)));
  return b!;
};
const inbound = async (phone: string) => {
  const b = await row(phone);
  return (await t.deps.db.select().from(messages).where(and(eq(messages.beneficiaryId, b.id), eq(messages.direction, "in")))).length;
};
const later = (ms: number) => t.clock.set(new Date(t.clock.current.getTime() + ms).toISOString());
async function moderator() {
  const v = await createVolunteer(t.deps);
  const { client } = makeClient(t.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return client;
}

describe("flood guard", () => {
  it("throttles a fast sender (stored, not processed, one notice), then serves them again after a minute", async () => {
    const p = "33611000001";
    for (const text of ["bonjour", "1", "2"]) await t.say(p, text);
    const before = (await t.outbound(p)).length;
    await t.say(p, "4");
    await t.say(p, "4");
    const out = await t.outbound(p);
    expect(out.slice(before)).toEqual([waText("fr", "guard_slow_down")]); // one notice, no menu answer
    expect(await inbound(p)).toBe(5);
    later(2 * 60_000);
    await t.say(p, "3");
    expect((await t.outbound(p)).length).toBeGreaterThan(out.length);
    expect((await t.outbound(p)).at(-1)).not.toBe(waText("fr", "guard_slow_down"));
  });

  it("limits photos per day: extra files are not analysed", async () => {
    const p = "33611000002";
    await t.say(p, "bonjour");
    await t.say(p, "1");
    const calls = t.tllm.analyzeCalls;
    for (let i = 0; i < 3; i++) {
      await t.photo(p);
      later(61_000);
    }
    expect(t.tllm.analyzeCalls - calls).toBe(2);
    expect((await t.outbound(p)).at(-1)).toBe(waText("fr", "guard_slow_down"));
  });

  it("quarantines a flooding number: nothing more is stored or sent to the LLM until a volunteer releases it", async () => {
    const p = "33611000003";
    for (let i = 0; i < 7; i++) await t.say(p, `spam ${i}`);
    const b = await row(p);
    expect(b.guardStatus).toBe("quarantined");
    expect(b.guardReason).toBe("flood");
    expect((await t.outbound(p)).at(-1)).toContain(waText("fr", "guard_held"));
    const stored = await inbound(p);
    for (let i = 0; i < 5; i++) await t.say(p, "more spam");
    expect(await inbound(p)).toBe(stored);

    const client = await moderator();
    expect(await client.numbers.heldCount()).toMatchObject({ count: 1, floodMode: false });
    const list = await client.numbers.list({ status: "quarantined" });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ beneficiaryId: b.id, reason: "flood", totalMessages: stored, lastText: "spam 6", knownBefore: false });
    expect(list.items[0]!.label).not.toContain("33611");

    await client.numbers.release({ beneficiaryId: b.id });
    await t.drain();
    expect((await row(p)).guardStatus).toBe("none");
    expect((await t.outbound(p)).at(-1)).toContain(waText("fr", "guard_released"));
    // Counters start from zero: the next message is handled normally.
    await t.say(p, "bonjour");
    expect(await inbound(p)).toBe(stored + 1);
    expect((await row(p)).guardStatus).toBe("none");
    expect(await client.numbers.heldCount()).toMatchObject({ count: 0 });
  });

  it("blocks a number: its messages are dropped and nothing is sent to it, reminders included; unblock restores it", async () => {
    const p = "33611000004";
    await t.say(p, "bonjour");
    const b = await row(p);
    const client = await moderator();
    await client.numbers.block({ beneficiaryId: b.id });
    const stored = await inbound(p);
    const sent = (await t.outbound(p)).length;
    await t.say(p, "hello");
    expect(await inbound(p)).toBe(stored);
    const { enqueueText } = await import("../src/whatsapp/send.js");
    await enqueueText(t.wdeps, b.id, "reminder");
    await t.drain();
    expect((await t.outbound(p)).length).toBe(sent);
    expect((await client.numbers.list({ status: "blocked" })).items.map((i) => i.beneficiaryId)).toContain(b.id);
    const conv = await client.conversations.get({ beneficiaryId: b.id });
    expect(conv.guard).toBe("blocked");

    await client.numbers.unblock({ beneficiaryId: b.id });
    await t.say(p, "hello");
    expect(await inbound(p)).toBe(stored + 1);
  });

  it("a blocked number stays blocked after 'delete my data'", async () => {
    const p = "33611000005";
    await t.say(p, "bonjour");
    const b = await row(p);
    await t.services.beneficiaries.archiveAll(b.id);
    await t.deps.db.update(beneficiaries).set({ guardStatus: "blocked", guardReason: "manual" }).where(eq(beneficiaries.id, b.id));
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(p);
    expect(beneficiary.id).not.toBe(b.id);
    expect(beneficiary.guardStatus).toBe("blocked");
  });
});

describe("global flood mode", () => {
  let g: WaCtx;
  beforeAll(async () => {
    g = await makeWa({ config: { ...LIMITS, WA_GLOBAL_PER_MINUTE: "4" }, now: "2026-11-07T10:00:00Z" });
  });
  afterAll(() => g.close());

  it("holds first messages of new numbers during a wave, keeps serving known people, and releases them all at once", async () => {
    const known = "33612000000";
    await g.say(known, "bonjour");
    g.clock.set("2026-11-09T10:00:00Z"); // two days later
    for (let i = 1; i <= 6; i++) await g.say(`3361200000${i}`, "salut");
    const statuses = [];
    for (let i = 1; i <= 6; i++) {
      const [b] = await g.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, g.deps.crypto.lookupHash(`3361200000${i}`)));
      statuses.push(b!.guardStatus);
    }
    expect(statuses).toEqual(["none", "none", "none", "none", "quarantined", "quarantined"]);
    // New person, language unknown: the notice comes in French, English and Arabic.
    expect((await g.outbound("33612000006")).at(-1)).toBe([waText("fr", "guard_held"), waText("en", "guard_held"), waText("ar", "guard_held")].join("\n\n"));

    const before = (await g.outbound(known)).length;
    await g.say(known, "3");
    expect((await g.outbound(known)).length).toBeGreaterThan(before);

    registerWaDeps(g.wdeps);
    const v = await createVolunteer(g.deps);
    const { client } = makeClient(g.deps);
    await client.auth.login({ email: v.email, password: v.password });
    expect((await client.numbers.list({ status: "quarantined" })).floodMode).toBe(true);
    expect(await client.numbers.releaseAllGlobal()).toEqual({ released: 2 });
    expect(await client.numbers.heldCount()).toMatchObject({ count: 0 });
    registerWaDeps(t.wdeps);
  });
});

describe("FloodGuard counters", () => {
  it("forget only the old messages", () => {
    const guard = new FloodGuard(testConfig(LIMITS));
    const b = { id: "x", createdAt: new Date("2020-01-01") };
    const at = (s: number) => new Date(Date.UTC(2026, 10, 7, 10, 0, s));
    expect([0, 1, 2].map((s) => guard.check(b, false, at(s)).kind)).toEqual(["ok", "ok", "ok"]);
    expect(guard.check(b, false, at(3))).toEqual({ kind: "throttle", notify: true });
    expect(guard.check(b, false, at(4))).toEqual({ kind: "throttle", notify: false });
    expect(guard.check(b, false, at(70)).kind).toBe("ok");
  });
});

describe("webhook in sandbox mode", () => {
  it("refuses unsigned POSTs in production", async () => {
    const h = fakeHttp("POST", "/webhooks/whatsapp", {}, "{}");
    await handleWhatsAppWebhook(h.req, h.res, { ...t.wdeps, config: { ...t.wdeps.config, NODE_ENV: "production" } });
    expect(h.result.status).toBe(403);
  });
});
