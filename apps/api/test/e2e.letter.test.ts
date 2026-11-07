import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { waText } from "@wilson/i18n";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";

let t: E2E;
beforeAll(async () => {
  t = await makeE2E();
});
afterAll(() => t.close());

const FSI = "⁨";
const PDI = "⁩";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

async function onboardArabic(phone: string) {
  const p = t.phone(phone);
  await p.say("مرحبا، أحتاج مساعدة");
  return p;
}
async function pendingLetterOf(phone: string) {
  const id = await beneficiaryIdOf(t, phone);
  const page = await t.client.letters.list({ limit: 50, status: ["pending_review"] });
  return page.items.filter((l) => l.beneficiaryId === id).at(-1)!;
}

describe("critical path 1: letter in -> review -> sent (public surfaces only)", () => {
  it("Arabic first message sets the language and welcomes", async () => {
    const p = await onboardArabic("33612000001");
    const id = await beneficiaryIdOf(t, "33612000001");
    expect((await t.client.beneficiaries.get({ id })).language).toBe("ar");
    expect((await p.out()).some((m) => m.includes(waText("ar", "welcome")))).toBe(true);
  });

  it("photo -> pending_review (deadline, urgency) -> outgoingText -> approve -> sent -> save offer '2' purges the photo", async () => {
    const p = await onboardArabic("33612000002");
    await p.say("1");
    await p.send(sampleFile("letters", "05-caf-demande-pieces.png"));

    const item = await pendingLetterOf(p.number);
    expect(item).toMatchObject({ status: "pending_review", deadline: "2026-11-20", urgency: "high", letterType: "caf", language: "ar" });

    const detail = await t.client.letters.get({ id: item.id });
    expect(detail.hasPhoto).toBe(true);
    const text = detail.outgoingText!;
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).toContain(FSI);
    expect(text).toContain(PDI);
    expect(text).toContain("٢٠"); // Arabic-Indic day
    expect(text).toContain("20 نوفمبر 2026"); // Western digits
    expect(text).toContain(t.config.ASSOCIATION_CONTACT);
    expect(text).toContain(t.config.ASSOCIATION_NAME);
    // nothing sent before approval
    expect((await p.out()).some((m) => m.includes(t.config.ASSOCIATION_CONTACT))).toBe(false);
    expect(await code(t.client.letters.photo({ id: item.id }))).toBe("ok");

    const approved = await t.client.letters.approve({ id: item.id });
    await t.queue.drain();
    expect(["approved", "sent"]).toContain(approved.status);
    const outs = await p.out();
    expect(outs).toContain(text);
    const after = await t.client.letters.get({ id: item.id });
    expect(after.status).toBe("sent");
    expect(after.history.map((h) => h.action)).toEqual(expect.arrayContaining(["analyzed", "approved", "sent"]));
    expect(await p.last()).toBe(`${waText("ar", "letter_offer_save")}\n${waText("ar", "letter_more_details")}`);

    await p.say("2");
    expect(await code(t.client.letters.photo({ id: item.id }))).toBe("NOT_FOUND");
    expect((await t.client.letters.get({ id: item.id })).hasPhoto).toBe(false);
  });

  it("reject: beneficiary gets the rejection text with footer and no AI text", async () => {
    const p = await onboardArabic("33612000003");
    await p.say("1");
    await p.send(sampleFile("letters", "05-caf-demande-pieces.png"));
    const item = await pendingLetterOf(p.number);
    const draft = (await t.client.letters.get({ id: item.id })).outgoingText!;
    const rejected = await t.client.letters.reject({ id: item.id, note: "illisible" });
    await t.queue.drain();
    expect(rejected.status).toBe("rejected");
    const last = await p.last();
    expect(last).toContain(waText("ar", "letter_rejected"));
    expect(last).toContain(t.config.ASSOCIATION_CONTACT);
    const outs = await p.out();
    expect(outs).not.toContain(draft);
    expect(outs.some((m) => m.includes("[ar]"))).toBe(false);
  });

  it("French edit then approve: translate called, new target sent", async () => {
    const p = await onboardArabic("33612000004");
    await p.say("1");
    await p.send(sampleFile("letters", "05-caf-demande-pieces.png"));
    const item = await pendingLetterOf(p.number);
    const detail = await t.client.letters.get({ id: item.id });
    const spy = vi.spyOn(t.fake, "translateLetterText");
    const edited = await t.client.letters.edit({ id: item.id, fr: { ...detail.analysis!.fr, title: "Titre corrigé par le bénévole" } });
    expect(edited.frEdited).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await t.client.letters.approve({ id: item.id });
    await t.queue.drain();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ targetLanguage: "ar" });
    const sent = (await p.out()).find((m) => m.includes("Titre corrigé par le bénévole"));
    expect(sent).toBeTruthy();
    expect(sent).toMatch(/ar\u2069\]/); // FakeProvider tags the retranslation with the target language
    spy.mockRestore();
  });

  it("OQTF is urgent and sorted first in the queue", async () => {
    const a = await onboardArabic("33612000005");
    await a.say("1");
    await a.send(sampleFile("letters", "09-impots-declaration-rappel.png")); // medium
    const b = await onboardArabic("33612000006");
    await b.say("1");
    await b.send(sampleFile("letters", "02-prefecture-oqtf.png"));
    const oqtf = await pendingLetterOf(b.number);
    expect(oqtf).toMatchObject({ urgency: "high", letterType: "prefecture_removal_order" });
    const queue = await t.client.letters.list({ limit: 50, status: ["pending_review"] });
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const ranks = queue.items.map((i) => rank[i.urgency ?? "low"]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect(queue.items[0]!.urgency).toBe("high");
    expect(queue.items.findIndex((i) => i.id === oqtf.id)).toBeLessThan(queue.items.findIndex((i) => i.letterType === "tax"));
  });
});
