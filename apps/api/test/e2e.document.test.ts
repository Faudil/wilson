import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { documentTypeName, formatDate, waText } from "@wilson/i18n";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";

let t: E2E;
beforeAll(async () => {
  t = await makeE2E();
});
afterAll(() => t.close());

const DAY = 86_400_000;

async function saveRecepisse(number: string, hello: string) {
  const p = t.phone(number);
  await p.say(hello);
  await p.say("2");
  await p.send(sampleFile("documents", "d1-recepisse.png"));
  return p;
}

describe("critical path 2: document -> reminders", () => {
  it("menu 2 -> photo -> confirm -> reminders D-30 / D-7, idempotent, reschedule, archive", async () => {
    const p = await saveRecepisse("33613000001", "مرحبا، أحتاج مساعدة");
    const confirm = await p.last();
    expect(confirm).toContain(formatDate("2027-03-14", "ar")); // written out, native + Western digits
    expect(confirm).toContain("١٤");
    expect(confirm).toContain(documentTypeName("recepisse", "ar"));

    await p.say("1");
    expect((await p.out()).at(-2)).toContain(formatDate("2027-03-14", "ar")); // "saved" message, then the menu

    const id = await beneficiaryIdOf(t, p.number);
    const detail = await t.client.beneficiaries.get({ id });
    expect(detail.documents).toHaveLength(1);
    const doc = detail.documents[0]!;
    expect(doc).toMatchObject({ type: "recepisse", expiresAt: "2027-03-14", expirySource: "detected" });
    expect(doc.reminders.map((r) => [r.kind, r.status])).toEqual([["d30", "scheduled"], ["d7", "scheduled"]]);
    expect(detail.nextExpiry).toBe("2027-03-14");
    const deadlines = await t.client.documents.deadlines({ withinDays: 365 });
    expect(deadlines.some((d) => d.documentId === doc.id)).toBe(true);

    const before = (await p.out()).length;
    expect((await t.client.sandbox.runReminders({ date: "2027-02-11" })).sent).toBe(0); // D-31
    expect((await t.client.sandbox.runReminders({ date: "2027-02-12" })).sent).toBe(1); // D-30
    const msgs = await p.out();
    expect(msgs).toHaveLength(before + 1);
    const r30 = msgs.at(-1)!;
    expect(r30).toContain(formatDate("2027-03-14", "ar"));
    expect(r30).toContain(documentTypeName("recepisse", "ar"));
    expect(r30).toContain(t.config.ASSOCIATION_CONTACT);
    expect((await t.client.sandbox.runReminders({ date: "2027-02-12" })).sent).toBe(0); // same day again
    expect((await p.out()).length).toBe(before + 1);
    expect((await t.client.sandbox.runReminders({ date: "2027-03-06" })).sent).toBe(0);
    expect((await t.client.sandbox.runReminders({ date: "2027-03-07" })).sent).toBe(1); // D-7
    expect((await p.out()).length).toBe(before + 2);

    const sentDoc = (await t.client.beneficiaries.get({ id })).documents[0]!;
    expect(sentDoc.reminders.map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("documents.update reschedules reminders; archive cancels them and sets purgeAt = +30 days", async () => {
    const p = await saveRecepisse("33613000002", "hello, I need help please");
    await p.say("1");
    const id = await beneficiaryIdOf(t, p.number);
    expect((await t.client.beneficiaries.get({ id })).language).toBe("en");
    const doc = (await t.client.beneficiaries.get({ id })).documents[0]!;

    const updated = await t.client.documents.update({ id: doc.id, expiresAt: "2027-06-30" });
    expect(updated.expiresAt).toBe("2027-06-30");
    const sched = updated.reminders.filter((r) => r.status === "scheduled");
    expect(sched.map((r) => r.kind).sort()).toEqual(["d30", "d7"]);
    expect(sched.find((r) => r.kind === "d30")!.dueAt.slice(0, 10)).toBe("2027-05-31");
    // old date no longer triggers anything
    expect((await t.client.sandbox.runReminders({ date: "2027-02-12" })).sent).toBe(0);
    expect((await t.client.sandbox.runReminders({ date: "2027-05-31" })).sent).toBeGreaterThanOrEqual(1);

    const archived = await t.client.documents.archive({ id: doc.id });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.reminders.filter((r) => r.status === "scheduled")).toHaveLength(0);
    expect(Date.parse(archived.purgeAt!) - Date.parse(archived.archivedAt!)).toBe(30 * DAY);
    expect(Date.parse(archived.purgeAt!) - t.clock.now().getTime()).toBe(30 * DAY);
    expect((await t.client.sandbox.runReminders({ date: "2027-06-23" })).sent).toBe(0);
  });

  it("typed date path in Persian digits for a fa user", async () => {
    const p = t.phone("33613000003");
    await p.say("سلام"); // detection unsure (0.75) -> language menu
    await p.say(String(LANGUAGE_CODES.indexOf("fa") + 1));
    const id = await beneficiaryIdOf(t, p.number);
    expect((await t.client.beneficiaries.get({ id })).language).toBe("fa");
    await p.say("2");
    await p.send(sampleFile("documents", "d1-recepisse.png"));
    await p.say("2"); // change the date
    expect(await p.last()).toContain(waText("fa", "document_enter_date").replace(/^‏/, "").split("\n")[0]!.slice(0, 5));
    await p.say("۱۴/۰۳/۲۰۲۷");
    const confirm = await p.last();
    expect(confirm).toContain(formatDate("2027-03-14", "fa"));
    await p.say("1");
    const doc = (await t.client.beneficiaries.get({ id })).documents[0]!;
    expect(doc).toMatchObject({ expiresAt: "2027-03-14", expirySource: "entered_by_user" });
    expect(doc.reminders.map((r) => r.kind)).toEqual(["d30", "d7"]);
  });
});
