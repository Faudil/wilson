import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documents, letterEvents, letters } from "../src/db/schema.js";
import { JOBS } from "../src/jobs/names.js";
import { makeWa, type WaCtx } from "./wa.helpers.js";

let t: WaCtx;
beforeAll(async () => {
  t = await makeWa();
});
afterAll(() => t.close());

const FSI = "⁨";

async function onboard(phone: string, choice = "2") {
  await t.say(phone, "hello"); // detection unsure -> language menu
  await t.say(phone, choice); // 2 = English
}
async function letterOf(phone: string) {
  const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(phone);
  const rows = await t.deps.db.select().from(letters).where(eq(letters.beneficiaryId, beneficiary.id));
  return { b: beneficiary, l: rows[rows.length - 1]! };
}

describe("letter flow (sandbox)", () => {
  it("photo -> pending_review -> approve -> reply with deadline, footer, isolation -> offer save -> '1' keeps it as a document", async () => {
    const p = "33611000001";
    await onboard(p);
    await t.say(p, "1");
    await t.photo(p);
    let { l } = await letterOf(p);
    expect(l.status).toBe("pending_review");
    expect(l.deadline).toBe("2026-12-08");
    expect(l.photoKey).toBeTruthy();
    expect(t.queue.jobs(JOBS.letterAnalyze)).toHaveLength(1);

    await t.wdeps.letters.approve(l.id, t.volunteerId);
    await t.drain();
    ({ l } = await letterOf(p));
    expect(l.status).toBe("sent");
    expect(l.sentAt).toBeTruthy();

    const out = await t.outbound(p);
    const reply = out.find((m) => m.includes("TITLE"))!;
    expect(reply).toContain("2026");
    expect(reply).toContain("8"); // deadline
    expect(reply).toContain(t.config.ASSOCIATION_CONTACT); // footer
    expect(reply).toContain(FSI);
    const { waText } = await import("@wilson/i18n");
    expect(out.at(-1)).toBe(waText("en", "letter_offer_save"));

    await t.say(p, "1");
    const { b } = await letterOf(p);
    const docs = await t.deps.db.select().from(documents).where(eq(documents.beneficiaryId, b.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.type).toBe("letter");
    ({ l } = await letterOf(p));
    expect(l.photoKey).toBeNull();
    expect((await t.services.beneficiaries.get(b.id))!.conversationState).toEqual({ step: "main_menu" });
  });

  it("answer '2' deletes the photo blob now", async () => {
    const p = "33611000002";
    await onboard(p);
    await t.photo(p);
    let { l } = await letterOf(p);
    const key = l.photoKey!;
    expect(t.blobs.has(key)).toBe(true);
    await t.wdeps.letters.approve(l.id, t.volunteerId);
    await t.drain();
    await t.say(p, "2");
    ({ l } = await letterOf(p));
    expect(l.photoKey).toBeNull();
    expect(t.blobs.has(key)).toBe(false);
  });

  it("reject sends the fixed 'a volunteer will contact you' message plus the footer", async () => {
    const p = "33611000003";
    await onboard(p);
    await t.photo(p);
    const { l } = await letterOf(p);
    await t.wdeps.letters.reject(l.id, t.volunteerId, "not clear");
    await t.drain();
    const { waText } = await import("@wilson/i18n");
    const out = await t.outbound(p);
    expect(out.at(-1)).toContain(waText("en", "letter_rejected"));
    expect(out.at(-1)).toContain(t.config.ASSOCIATION_CONTACT);
    expect((await letterOf(p)).l.status).toBe("rejected");
  });

  it("editing the French text makes approve retranslate before sending", async () => {
    const p = "33611000004";
    await onboard(p);
    await t.photo(p);
    const { l } = await letterOf(p);
    const detail = (await t.wdeps.letters.get(l.id))!;
    const before = t.tllm.translateCalls;
    const edited = await t.wdeps.letters.edit({ id: l.id, fr: { ...detail.analysis!.fr, title: "Titre corrigé" } }, t.volunteerId);
    expect(edited.frEdited).toBe(true);
    expect(t.tllm.translateCalls).toBe(before); // nothing until approve
    const approved = await t.wdeps.letters.approve(l.id, t.volunteerId);
    expect(t.tllm.translateCalls).toBe(before + 1);
    expect(approved.history.map((h) => h.action)).toEqual(["analyzed", "edited", "retranslated", "approved"]);
    await t.drain();
    expect((await t.outbound(p)).some((m) => m.includes("RETRANSLATED Titre corrigé"))).toBe(true);
  });

  it("LLM failure marks the letter failed; list sorts pending first", async () => {
    const p = "33611000005";
    await onboard(p);
    t.tllm.failAnalyze = true;
    await t.photo(p);
    t.tllm.failAnalyze = false;
    const { l } = await letterOf(p);
    expect(l.status).toBe("failed");
    const ev = await t.deps.db.select().from(letterEvents).where(eq(letterEvents.letterId, l.id));
    expect(ev.map((e) => e.action)).toContain("failed");
    const page = await t.wdeps.letters.list({ limit: 50 });
    const statuses = page.items.map((i) => i.status);
    const firstNonPending = statuses.findIndex((s) => s !== "pending_review");
    expect(statuses.slice(firstNonPending).includes("pending_review")).toBe(false);
  });

  it("purges photos of sent letters after PHOTO_TTL_HOURS", async () => {
    const p = "33611000006";
    await onboard(p);
    await t.photo(p);
    const { l } = await letterOf(p);
    await t.wdeps.letters.approve(l.id, t.volunteerId);
    await t.drain();
    expect(await t.wdeps.letters.purgeExpiredPhotos(t.clock.now())).toBe(0);
    expect(await t.wdeps.letters.purgeExpiredPhotos(new Date(t.clock.now().getTime() + 49 * 3600e3))).toBeGreaterThanOrEqual(1);
    expect((await letterOf(p)).l.photoKey).toBeNull();
  });

  it("audio gets the unsupported-media message; menu 0 gives the contact", async () => {
    const p = "33611000007";
    await onboard(p);
    const { waText } = await import("@wilson/i18n");
    await t.say(p, "0");
    expect((await t.outbound(p)).at(-1)).toBe(
      waText("en", "human_contact", { name: t.config.ASSOCIATION_NAME, contact: t.config.ASSOCIATION_CONTACT }),
    );
  });
});
