import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { letters } from "../src/db/schema.js";
import { makeWa, type WaCtx } from "./wa.helpers.js";

let t: WaCtx;
beforeAll(async () => {
  t = await makeWa({ meta: true, now: "2026-11-06T09:00:00Z" });
  t.tllm.nextLanguage = { language: "en", confidence: 0.95 };
});
afterAll(() => t.close());

describe("24 h window (meta mode)", () => {
  it("outside the window the reviewed reply waits behind the template until the user answers", async () => {
    const p = "33622000001";
    await t.say(p, "Hello, I need help");
    await t.photo(p);
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(p);
    const [l] = await t.deps.db.select().from(letters).where(eq(letters.beneficiaryId, beneficiary.id));
    expect(l!.status).toBe("pending_review");

    const sentBefore = t.meta!.texts.length;
    t.clock.set("2026-11-07T15:00:00Z"); // 30 h later
    await t.wdeps.letters.approve(l!.id, t.volunteerId);
    await t.drain();

    expect(t.meta!.templates).toEqual([{ to: p, template: "explanation_ready", params: [] }]);
    expect(t.meta!.texts).toHaveLength(sentBefore); // nothing free-form
    const [held] = await t.deps.db.select().from(letters).where(eq(letters.id, l!.id));
    expect(held!.awaitingOptIn).toBe(true);
    expect(held!.status).toBe("approved");

    await t.say(p, "OK");
    const [done] = await t.deps.db.select().from(letters).where(eq(letters.id, l!.id));
    expect(done!.status).toBe("sent");
    expect(done!.awaitingOptIn).toBe(false);
    const last = t.meta!.texts.filter((m) => m.body.includes("TITLE"));
    expect(last).toHaveLength(1);
    expect(last[0]!.body).toContain(t.config.ASSOCIATION_CONTACT);
    // a second "OK" does not resend it
    await t.say(p, "OK");
    expect(t.meta!.texts.filter((m) => m.body.includes("TITLE"))).toHaveLength(1);
  });
});
