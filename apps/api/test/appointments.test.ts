import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { ROLE_PERMISSIONS, type Permission } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { accessLog, beneficiaries, helpReminders, helpRequests, volunteerPermissions, volunteers } from "../src/db/schema.js";
import { getAppointments } from "../src/appointments/service.js";
import { toInteractive } from "../src/whatsapp/interactive.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");
/** The last outbound messages, joined (the main menu often follows the one we look for). */
const recent = async (p: { out(): Promise<string[]> }, n = 3) => (await p.out()).slice(-n).map(plain).join("\n---\n");

/** A volunteer with exactly a role's bundle, plus/minus per-person overrides, logged in. */
async function volunteer(e: E2E, opts: { role?: "volunteer" | "admin"; name?: string; grant?: Permission[]; revoke?: Permission[] } = {}) {
  const v = await createVolunteer(e.deps, { role: opts.role ?? "volunteer", name: opts.name ?? "Samia Bénévole" });
  for (const p of opts.grant ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: true });
  for (const p of opts.revoke ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: false });
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return { ...v, client };
}

/** French speaker at the main menu. */
async function frenchPhone(e: E2E, number: string) {
  const p = e.phone(number);
  await p.say("1"); // language 1 = Français
  return p;
}

async function requestAccompaniment(e: E2E, number: string, when = "20/11/2026 9:30", city = "Bobigny") {
  const p = await frenchPhone(e, number);
  await p.say("8");
  await p.say("1"); // come with me
  await p.say("1"); // préfecture
  await p.say(when);
  await p.say(city);
  return p;
}

describe("default rights per role", () => {
  it("responders get no appointment right; volunteers can view, accept, publish slots and open consented documents; only admins manage", () => {
    expect(ROLE_PERMISSIONS.responder.filter((p) => p.startsWith("appointments."))).toEqual([]);
    expect(ROLE_PERMISSIONS.volunteer.filter((p) => p.startsWith("appointments.")).sort()).toEqual(["appointments.accept", "appointments.documents", "appointments.slots", "appointments.view"]);
    expect(ROLE_PERMISSIONS.admin).toContain("appointments.manage");
  });
});

describe("accompaniment to an appointment", () => {
  it("WhatsApp request → volunteers see it without who → accept with a meeting point → person told → reminders D-1 and H-2", async () => {
    t = await makeE2E();
    const p = await requestAccompaniment(t, "33615000001");
    const confirm = plain(await p.last());
    expect(confirm).toContain("Votre demande :");
    expect(confirm).toContain("📌 Préfecture");
    expect(confirm).toContain("📅 vendredi 20 novembre 2026 · 09:30");
    expect(confirm).toContain("📍 Bobigny");
    await p.say("1");
    expect((await p.out()).some((m) => m.includes(waText("fr", "help_request_sent")))).toBe(true);

    const v = await volunteer(t, { name: "Samia Haddad" });
    const open = await v.client.appointments.list({ view: "open" });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "accompaniment", topic: "prefecture", status: "open", city: "Bobigny", language: "fr", mine: false, beneficiaryLabel: null, beneficiaryId: null });
    expect(open[0]!.startsAt).toBe("2026-11-20T08:30:00.000Z"); // 09:30 Paris
    expect(await v.client.appointments.counts()).toEqual({ open: 1, mineSoon: 0 });

    const accepted = await v.client.appointments.accept({ id: open[0]!.id, meetingPoint: "Devant l'entrée principale" });
    await t.queue.drain();
    expect(accepted).toMatchObject({ status: "accepted", mine: true, volunteerName: "Samia Haddad", meetingPoint: "Devant l'entrée principale" });
    expect(accepted.beneficiaryLabel).toMatch(/01$/); // masked label, only now
    const told = plain(await p.last());
    expect(told).toContain("C'est confirmé : Samia va vous aider.");
    expect(told).toContain("📍 Devant l'entrée principale");
    expect(told).toContain("pas un conseil juridique"); // footer

    // Someone else is too late
    const other = await volunteer(t, { name: "Paul" });
    expect(await code(other.client.appointments.accept({ id: accepted.id, meetingPoint: "Ailleurs" }))).toBe("CONFLICT");

    const rem = await t.deps.db.select().from(helpReminders).where(eq(helpReminders.requestId, accepted.id));
    expect(rem.map((r) => [r.kind, r.dueAt.toISOString()]).sort()).toEqual([["d1", "2026-11-19T08:30:00.000Z"], ["h2", "2026-11-20T06:30:00.000Z"]]);

    const svc = getAppointments(t.wdeps);
    expect((await svc.dispatch(new Date("2026-11-19T08:00:00Z"))).reminders).toBe(0);
    expect((await svc.dispatch(new Date("2026-11-19T08:31:00Z"))).reminders).toBe(1);
    expect((await svc.dispatch(new Date("2026-11-19T08:46:00Z"))).reminders).toBe(0); // exactly once
    await t.queue.drain();
    expect(plain(await p.last())).toContain("Rappel : rendez-vous avec Samia.");

    // The holder gives it back: the person is told and it is open again (time and city kept: it is their appointment)
    const released = await v.client.appointments.release({ id: accepted.id });
    await t.queue.drain();
    expect(released).toMatchObject({ status: "open", volunteerName: null, startsAt: "2026-11-20T08:30:00.000Z", city: "Bobigny", meetingPoint: null });
    expect(plain(await p.last())).toContain("le bénévole ne peut plus venir");
    expect((await t.deps.db.select().from(helpReminders).where(and(eq(helpReminders.requestId, accepted.id), eq(helpReminders.status, "scheduled"))))).toHaveLength(0);

    const log = await t.deps.db.select().from(accessLog).where(eq(accessLog.volunteerId, v.id));
    expect(log.map((l) => l.action)).toEqual(["appointments.accept", "appointments.release"]);
  });

  it("refuses past or unreadable dates, 0 skips the city, 2 cancels the draft; nobody accepting before the time → expired and the person is told", async () => {
    t = await makeE2E();
    const p = await frenchPhone(t, "33615000002");
    await p.say("8");
    await p.say("1");
    await p.say("2"); // OFII
    await p.say("01/01/2020 10:00");
    expect(await p.last()).toBe(waText("fr", "help_datetime_invalid"));
    await p.say("demain matin");
    expect(await p.last()).toBe(waText("fr", "help_datetime_invalid"));
    await p.say("10/11/2026 14h");
    await p.say("0");
    expect(plain(await p.last())).not.toContain("📍");
    await p.say("1");

    const svc = getAppointments(t.wdeps);
    expect((await svc.dispatch(new Date("2026-11-10T13:01:00Z"))).expired).toBe(1);
    await t.queue.drain();
    expect(plain(await p.last())).toContain("aucun bénévole n'était disponible");
    const v = await volunteer(t);
    expect(await v.client.appointments.list({ view: "open" })).toHaveLength(0);

    // A request abandoned at the confirmation step never reaches volunteers
    await p.say("8");
    await p.say("1");
    await p.say("3");
    await p.say("12/12/2026 10:00");
    await p.say("Paris");
    await p.say("2");
    expect(await v.client.appointments.list({ view: "open" })).toHaveLength(0);
    const bid = await beneficiaryIdOf(t, p.number);
    expect(await t.deps.db.select().from(helpRequests).where(and(eq(helpRequests.beneficiaryId, bid), eq(helpRequests.status, "draft")))).toHaveLength(0);
  });

  it("the city is stored encrypted, never in the conversation state; 'delete all my data' cancels everything", async () => {
    t = await makeE2E();
    const p = await requestAccompaniment(t, "33615000003", "20/11/2026 9:30", "Saint-Denis");
    const bid = await beneficiaryIdOf(t, p.number);
    const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(JSON.stringify(b!.conversationState)).not.toContain("Saint-Denis");
    const [r] = await t.deps.db.select().from(helpRequests).where(eq(helpRequests.beneficiaryId, bid));
    expect(r!.cityEnc!.toString("utf8")).not.toContain("Saint-Denis");
    await p.say("1");

    await p.say("9");
    await p.say("1");
    const [after] = await t.deps.db.select().from(helpRequests).where(eq(helpRequests.beneficiaryId, bid));
    expect(after!.status).toBe("cancelled");
    const v = await volunteer(t);
    expect(await v.client.appointments.list({ view: "open" })).toHaveLength(0);
  });

  it("the person lists and cancels from WhatsApp; the volunteer's appointment shows cancelled", async () => {
    t = await makeE2E();
    const p = await requestAccompaniment(t, "33615000004");
    await p.say("1");
    const v = await volunteer(t);
    const [a] = await v.client.appointments.list({ view: "open" });
    await v.client.appointments.accept({ id: a!.id, meetingPoint: "Métro Bobigny" });
    await t.queue.drain();

    await p.say("8");
    await p.say("3");
    const list = plain(await p.last());
    expect(list).toContain("1 - ✅ Préfecture · vendredi 20 novembre 2026 · 09:30");
    expect(toInteractive(await p.last())?.choices.map((c) => c.id)).toEqual(["1", "0"]);
    await p.say("1");
    expect(plain(await p.last())).toContain("Annuler ce rendez-vous ?");
    await p.say("1");
    expect(await recent(p)).toContain(waText("fr", "help_cancelled"));
    const [mine] = await v.client.appointments.list({ view: "mine" });
    expect(mine).toMatchObject({ id: a!.id, status: "cancelled" });
    expect(await code(v.client.appointments.complete({ id: a!.id }))).toBe("CONFLICT");
  });
});

describe("form-filling sessions", () => {
  it("volunteer publishes slots → person books one on WhatsApp with consent → documents open for that volunteer only, logged", async () => {
    t = await makeE2E();
    const v = await volunteer(t, { name: "Karim Formulaires" });
    await v.client.appointments.addSlot({ startsAt: "2026-11-12T13:00:00.000Z", durationMin: 90, place: "Local SMW, 12 rue de la Paix" });
    await v.client.appointments.addSlot({ startsAt: "2026-11-13T09:00:00.000Z", durationMin: 60, place: "Par téléphone" });
    expect(await code(v.client.appointments.addSlot({ startsAt: "2026-11-01T09:00:00.000Z", durationMin: 60, place: "Hier" }))).toBe("CONFLICT");

    const p = await frenchPhone(t, "33615000005");
    await p.say("2"); // My documents: save one first
    await p.send(sampleFile("documents", "d1-recepisse.png"));
    await p.say("1");
    await p.say("8");
    await p.say("2"); // fill in a form
    await p.say("1"); // CAF
    const offer = plain(await p.last());
    expect(offer).toContain("1 - jeudi 12 novembre 2026 · 14:00 — Local SMW, 12 rue de la Paix");
    expect(offer).toContain("2 - vendredi 13 novembre 2026 · 10:00 — Par téléphone");
    expect(toInteractive(await p.last())?.choices.map((c) => c.id)).toEqual(["1", "2", "0"]);
    await p.say("1");
    expect(await p.last()).toBe(waText("fr", "help_consent"));
    await p.say("1"); // yes, the volunteer may see my documents
    const booked = await recent(p);
    expect(booked).toContain("Karim va vous aider");
    expect(booked).toContain("📌 CAF (allocations)");

    const [mine] = await v.client.appointments.list({ view: "mine" });
    expect(mine).toMatchObject({ kind: "form_session", topic: "caf", status: "accepted", documentsConsent: true, canOpenDocuments: true, meetingPoint: "Local SMW, 12 rue de la Paix" });
    expect((await v.client.appointments.slots({ scope: "mine" })).map((s) => s.booked)).toEqual([true, false]);
    // A booked slot cannot simply vanish: it has to be given back (the person is told)
    const [bookedSlot] = await v.client.appointments.slots({ scope: "mine" });
    expect(await code(v.client.appointments.removeSlot({ id: bookedSlot!.id }))).toBe("CONFLICT");

    const docs = await v.client.appointments.documents({ id: mine!.id });
    expect(docs.map((d) => d.type)).toEqual(["recepisse"]);
    const file = await v.client.appointments.documentFile({ id: mine!.id, documentId: docs[0]!.id });
    expect(file.size).toBeGreaterThan(0);
    const log = (await t.deps.db.select().from(accessLog).where(eq(accessLog.volunteerId, v.id))).map((l) => l.action);
    expect(log).toContain("appointments.documents");
    expect(log).toContain("appointments.document_file");

    // Another volunteer, even with the same rights, cannot open them; nor can the holder once the right is revoked
    const other = await volunteer(t, { name: "Autre" });
    expect(await code(other.client.appointments.documents({ id: mine!.id }))).toBe("FORBIDDEN");
    await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: "appointments.documents", granted: false });
    expect(await code(v.client.appointments.documents({ id: mine!.id }))).toBe("FORBIDDEN");
    await t.deps.db.delete(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, v.id));

    // Someone else's document id through this appointment: not found
    const p2 = await frenchPhone(t, "33615000006");
    await p2.say("2");
    await p2.send(sampleFile("documents", "d1-recepisse.png"));
    await p2.say("1");
    const otherDoc = (await t.services.documents.listForBeneficiary(await beneficiaryIdOf(t, p2.number)))[0]!;
    expect(await code(v.client.appointments.documentFile({ id: mine!.id, documentId: otherDoc.id }))).toBe("NOT_FOUND");

    // After the session (+24 h) the access is gone even if nobody clicked "done"
    t.clock.set("2026-11-13T15:00:00Z");
    await v.client.auth.login({ email: v.email, password: v.password }); // the session itself expired meanwhile
    expect(await code(v.client.appointments.documents({ id: mine!.id }))).toBe("FORBIDDEN");
  });

  it("no consent → no documents; the second person gets what is left of the slots; no slot → open request a volunteer times", async () => {
    t = await makeE2E();
    const v = await volunteer(t, { name: "Karim" });
    await v.client.appointments.addSlot({ startsAt: "2026-11-12T13:00:00.000Z", durationMin: 60, place: "Local" });

    const a = await frenchPhone(t, "33615000007");
    await a.say("8");
    await a.say("2");
    await a.say("3"); // AME
    await a.say("1");
    await a.say("2"); // no, do not show my documents
    const [mine] = await v.client.appointments.list({ view: "mine" });
    expect(mine).toMatchObject({ topic: "ame", documentsConsent: false, canOpenDocuments: false });
    expect(await code(v.client.appointments.documents({ id: mine!.id }))).toBe("FORBIDDEN");

    const b = await frenchPhone(t, "33615000008");
    await b.say("8");
    await b.say("2");
    await b.say("2"); // ANEF
    expect(await b.last()).toBe(waText("fr", "help_consent")); // no slot left: straight to consent
    expect((await b.out()).some((m) => m === waText("fr", "help_no_slots"))).toBe(true);
    await b.say("1");
    const open = await v.client.appointments.list({ view: "open" });
    expect(open).toMatchObject([{ topic: "anef", startsAt: null, documentsConsent: true }]);
    expect(await code(v.client.appointments.accept({ id: open[0]!.id, meetingPoint: "Local" }))).toBe("CONFLICT"); // time_required
    const accepted = await v.client.appointments.accept({ id: open[0]!.id, meetingPoint: "Local", startsAt: "2026-11-16T14:00:00.000Z" });
    await t.queue.drain();
    expect(accepted).toMatchObject({ status: "accepted", startsAt: "2026-11-16T14:00:00.000Z", canOpenDocuments: true });
    expect(plain(await b.last())).toContain("📅 lundi 16 novembre 2026 · 15:00");
  });

  it("two people racing for the same slot: one gets it, the other is shown the remaining times", async () => {
    t = await makeE2E();
    const v = await volunteer(t);
    await v.client.appointments.addSlot({ startsAt: "2026-11-12T13:00:00.000Z", durationMin: 60, place: "Local" });
    const a = await frenchPhone(t, "33615000009");
    const b = await frenchPhone(t, "33615000010");
    for (const p of [a, b]) {
      await p.say("8");
      await p.say("2");
      await p.say("1");
      await p.say("1"); // both pick slot 1
    }
    await a.say("1");
    await b.say("1");
    expect(await recent(a)).toContain("va vous aider");
    // b: the slot is gone → no slot left → consent question again for an open request
    expect(await b.last()).toBe(waText("fr", "help_consent"));
    expect((await v.client.appointments.list({ view: "mine" }))).toHaveLength(1);
  });
});

describe("rights are enforced on the server", () => {
  it("a responder (self-signup default) sees nothing; per-person grants open exactly what they name", async () => {
    t = await makeE2E();
    const r = await createVolunteer(t.deps, { name: "Responder" });
    await t.deps.db.update(volunteers).set({ role: "responder" }).where(eq(volunteers.id, r.id));
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: r.email, password: r.password });
    for (const call of [
      () => client.appointments.list({ view: "open" }), () => client.appointments.counts(), () => client.appointments.slots({ scope: "mine" }),
      () => client.appointments.addSlot({ startsAt: "2026-12-01T10:00:00.000Z", durationMin: 60, place: "Local" }),
    ]) expect(await code(call())).toBe("FORBIDDEN");

    await t.deps.db.insert(volunteerPermissions).values({ volunteerId: r.id, permission: "appointments.view", granted: true });
    expect(await code(client.appointments.list({ view: "open" }))).toBe("ok");
    const p = await requestAccompaniment(t, "33615000011");
    await p.say("1");
    const [a] = await client.appointments.list({ view: "open" });
    expect(await code(client.appointments.accept({ id: a!.id, meetingPoint: "Entrée" }))).toBe("FORBIDDEN"); // view ≠ accept
    expect(await code(client.appointments.list({ view: "all" }))).toBe("FORBIDDEN"); // all = manage
  });

  it("only the holder or a manager can release / complete; only a manager can cancel or remove someone else's slot", async () => {
    t = await makeE2E();
    const holder = await volunteer(t, { name: "Holder" });
    const peer = await volunteer(t, { name: "Peer" });
    const admin = await volunteer(t, { role: "admin", name: "Admin" });
    const p = await requestAccompaniment(t, "33615000012");
    await p.say("1");
    const [a] = await holder.client.appointments.list({ view: "open" });
    await holder.client.appointments.accept({ id: a!.id, meetingPoint: "Entrée" });

    expect(await code(peer.client.appointments.release({ id: a!.id }))).toBe("FORBIDDEN");
    expect(await code(peer.client.appointments.complete({ id: a!.id }))).toBe("FORBIDDEN");
    expect(await code(peer.client.appointments.cancel({ id: a!.id }))).toBe("FORBIDDEN");
    expect((await peer.client.appointments.list({ view: "mine" }))).toHaveLength(0);

    const all = await admin.client.appointments.list({ view: "all" });
    expect(all[0]).toMatchObject({ volunteerName: "Holder", mine: false });
    expect(all[0]!.beneficiaryLabel).not.toBeNull();

    const slot = await holder.client.appointments.addSlot({ startsAt: "2026-12-01T10:00:00.000Z", durationMin: 60, place: "Local" });
    expect(await code(peer.client.appointments.removeSlot({ id: slot.id }))).toBe("FORBIDDEN");
    expect(await code(peer.client.appointments.slots({ scope: "all" }))).toBe("FORBIDDEN");
    expect(await code(admin.client.appointments.removeSlot({ id: slot.id }))).toBe("ok");

    const cancelled = await admin.client.appointments.cancel({ id: a!.id });
    await t.queue.drain();
    expect(cancelled.status).toBe("cancelled");
    expect(plain(await p.last())).toContain("Ce rendez-vous avec un bénévole est annulé");
  });
});

describe("other languages", () => {
  it("Arabic: menus stay tap-able, the summary is RTL-safe and the Latin city is isolated", async () => {
    t = await makeE2E();
    const p = t.phone("33615000013");
    await p.say("مرحبا، أحتاج مساعدة");
    await p.say("8");
    expect(toInteractive(await p.last())?.choices.map((c) => c.id)).toEqual(["1", "2", "3", "0"]);
    await p.say("1");
    await p.say("١");
    await p.say("٢٠/١١/٢٠٢٦ ٩:٣٠");
    await p.say("Bobigny");
    const confirm = await p.last();
    expect(confirm).toContain("⁨Bobigny⁩");
    for (const line of confirm.split("\n").filter(Boolean)) expect(line.startsWith("‏"), line).toBe(true);
    expect(toInteractive(confirm)?.choices.map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("menus in all 28 languages", () => {
  it("every Rendez-vous menu becomes tap-able buttons or a list whose ids are the typed numbers", async () => {
    const { LANGUAGE_CODES } = await import("@wilson/contracts");
    const ids = (text: string) => toInteractive(text)?.choices.map((c) => c.id);
    for (const l of LANGUAGE_CODES) {
      expect([l, ids(waText(l, "help_menu"))]).toEqual([l, ["1", "2", "3", "0"]]);
      expect([l, ids(waText(l, "help_place_menu"))]).toEqual([l, ["1", "2", "3", "4", "5"]]);
      expect([l, ids(waText(l, "help_form_menu"))]).toEqual([l, ["1", "2", "3", "4"]]);
      expect([l, ids(waText(l, "help_consent"))]).toEqual([l, ["1", "2"]]);
      expect([l, ids(waText(l, "help_confirm").replace("{summary}", "📌 x"))]).toEqual([l, ["1", "2"]]);
      expect([l, ids(waText(l, "help_cancel_confirm").replace("{summary}", "📌 x"))]).toEqual([l, ["1", "2"]]);
      expect(waText(l, "help_slots_other")).toMatch(/^‏?0 - /);
      expect(waText(l, "help_list_back")).toMatch(/^‏?0 - /);
      expect(waText(l, "help_reminder"), l).toMatch(/8\D+3/); // "reply 8 then 3 to cancel"
    }
  });
});
