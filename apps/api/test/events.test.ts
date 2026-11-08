import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { ROLE_PERMISSIONS, type EventInput, type Permission } from "@wilson/contracts";
import { eventText } from "@wilson/i18n";
import { accessLog, associations, eventRegistrations, volunteerPermissions, volunteers } from "../src/db/schema.js";
import { getEvents } from "../src/events/service.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const reason = (p: Promise<unknown>) => p.then(() => "ok", (e: { data?: { reason?: string } }) => e.data?.reason ?? "none");
const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");

async function volunteer(e: E2E, opts: { role?: "volunteer" | "admin"; name?: string; grant?: Permission[]; revoke?: Permission[]; associationId?: string; associationAdmin?: boolean } = {}) {
  const v = await createVolunteer(e.deps, { role: opts.role ?? "volunteer", name: opts.name ?? "Samia Bénévole" });
  for (const p of opts.grant ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: true });
  for (const p of opts.revoke ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: false });
  if (opts.associationId) await e.deps.db.update(volunteers).set({ associationId: opts.associationId, associationAdmin: opts.associationAdmin ?? false }).where(eq(volunteers.id, v.id));
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return { ...v, client };
}

async function association(e: E2E, name: string): Promise<string> {
  const [a] = await e.deps.db.insert(associations).values({ name }).returning();
  return a!.id;
}

const maraude = (o: Partial<EventInput> = {}): EventInput => ({
  kind: "maraude", title: "Maraude gare de l'Est", description: "Thé, soupe, couvertures.", place: "Parvis de la gare de l'Est",
  date: "2026-11-20", startTime: "19:30", endTime: "22:30", volunteerSpots: null, public: false, publicSpots: null, languages: [], skills: [], ...o,
});

describe("default rights per role", () => {
  it("everyone sees the Agenda and signs up; creating and managing is for admins and association admins", () => {
    expect(ROLE_PERMISSIONS.responder.filter((p) => p.startsWith("events."))).toEqual(["events.view", "events.join"]);
    expect(ROLE_PERMISSIONS.volunteer.filter((p) => p.startsWith("events."))).toEqual(["events.view", "events.join"]);
    expect(ROLE_PERMISSIONS.admin).toContain("events.create");
    expect(ROLE_PERMISSIONS.admin).toContain("events.manage");
  });
});

describe("volunteers sign up", () => {
  it("places fill up, the next one waits, and moves up when someone takes their name off", async () => {
    t = await makeE2E();
    const admin = await volunteer(t, { role: "admin", name: "Nadia Coordinatrice" });
    const e = await admin.client.events.create(maraude({ volunteerSpots: 2, languages: ["ar"], skills: ["health"] }));
    expect(e).toMatchObject({ date: "2026-11-20", startTime: "19:30", endTime: "22:30", going: 0, canEdit: true, createdByName: "Nadia Coordinatrice", association: null });
    expect(e.startsAt).toBe("2026-11-20T18:30:00.000Z"); // 19:30 Paris

    const a = await volunteer(t, { name: "Ali" });
    const b = await volunteer(t, { name: "Bea" });
    const c = await volunteer(t, { name: "Chloé" });
    await t.deps.db.execute(`insert into volunteer_skills (volunteer_id, languages, skills) values ('${c.id}', '{ar}', '{}')`);
    expect((await a.client.events.join({ id: e.id })).myStatus).toBe("going");
    expect((await b.client.events.join({ id: e.id })).myStatus).toBe("going");
    const third = await c.client.events.join({ id: e.id });
    expect(third).toMatchObject({ myStatus: "waitlist", myPosition: 1, going: 2, waiting: 1, matchesMe: true, canEdit: false });
    expect(third.attendees.map((x) => [x.name, x.status, x.position, x.matches])).toEqual([["Ali", "going", null, false], ["Bea", "going", null, false], ["Chloé", "waitlist", 1, true]]);
    // Joining twice changes nothing.
    expect((await c.client.events.join({ id: e.id })).waiting).toBe(1);

    await a.client.events.leave({ id: e.id });
    const after = await c.client.events.get({ id: e.id });
    expect(after).toMatchObject({ myStatus: "going", going: 2, waiting: 0 });

    // "mine" lists only what I signed up for.
    expect((await c.client.events.list({ scope: "mine" })).map((x) => x.id)).toEqual([e.id]);
    expect(await a.client.events.list({ scope: "mine" })).toEqual([]);

    // The organiser takes someone off; a volunteer cannot.
    expect(await code(b.client.events.removeAttendee({ id: e.id, volunteerId: c.id }))).toBe("FORBIDDEN");
    expect((await admin.client.events.removeAttendee({ id: e.id, volunteerId: c.id })).going).toBe(1);

    const log = await t.deps.db.select().from(accessLog).where(eq(accessLog.targetId, e.id));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["events.create", "events.join", "events.leave"]));
  });

  it("cancelled or past events cannot be joined; volunteers without events.create cannot create", async () => {
    t = await makeE2E();
    const admin = await volunteer(t, { role: "admin" });
    const v = await volunteer(t);
    expect(await code(v.client.events.create(maraude()))).toBe("FORBIDDEN");
    expect(await reason(admin.client.events.create(maraude({ date: "2026-11-01" })))).toBe("past");
    const e = await admin.client.events.create(maraude());
    await admin.client.events.cancel({ id: e.id });
    expect(await reason(v.client.events.join({ id: e.id }))).toBe("cancelled");
    expect((await v.client.events.list({ scope: "upcoming" }))[0]!.cancelledAt).not.toBeNull();
  });
});

describe("association scope", () => {
  it("members see their association's events and those for everyone; association admins manage only their own", async () => {
    t = await makeE2E();
    const a = await association(t, "Utopia 56");
    const b = await association(t, "Solidarité Paris");
    const global = await volunteer(t, { role: "admin", name: "Global" });
    const aAdmin = await volunteer(t, { name: "Admin A", associationId: a, associationAdmin: true });
    const aMember = await volunteer(t, { name: "Membre A", associationId: a });
    const bMember = await volunteer(t, { name: "Membre B", associationId: b });

    const me = await aAdmin.client.auth.me();
    expect(me.permissions).toEqual(expect.arrayContaining(["events.create", "events.manage"]));

    const ofA = await aAdmin.client.events.create(maraude({ associationId: b })); // association admins always create in their own
    expect(ofA.association).toMatchObject({ id: a, name: "Utopia 56" });
    const forAll = await global.client.events.create(maraude({ title: "Réunion inter-associations", kind: "meeting" }));
    const ofB = await global.client.events.create(maraude({ title: "Formation B", kind: "training", associationId: b }));

    const ids = async (c: typeof aMember.client) => (await c.events.list({ scope: "upcoming" })).map((x) => x.id).sort();
    expect(await ids(aMember.client)).toEqual([ofA.id, forAll.id].sort());
    expect(await ids(bMember.client)).toEqual([forAll.id, ofB.id].sort());
    expect(await ids(global.client)).toEqual([ofA.id, forAll.id, ofB.id].sort());
    expect(await code(bMember.client.events.get({ id: ofA.id }))).toBe("NOT_FOUND");
    expect(await code(bMember.client.events.join({ id: ofA.id }))).toBe("NOT_FOUND");

    // Admin A edits A's event, not the one for everyone, and cannot even see B's.
    expect((await aAdmin.client.events.update({ id: ofA.id, event: maraude({ title: "Maraude modifiée" }) })).title).toBe("Maraude modifiée");
    expect(await code(aAdmin.client.events.update({ id: forAll.id, event: maraude() }))).toBe("FORBIDDEN");
    expect(await code(aAdmin.client.events.cancel({ id: ofB.id }))).toBe("NOT_FOUND");
    expect((await aAdmin.client.events.get({ id: forAll.id })).canEdit).toBe(false);

    // An organiser (events.create granted) edits their own event only.
    const organiser = await volunteer(t, { name: "Orga", associationId: a, grant: ["events.create"] });
    const own = await organiser.client.events.create(maraude({ title: "Atelier CV", kind: "workshop" }));
    expect((await organiser.client.events.cancel({ id: own.id })).cancelledAt).not.toBeNull();
    expect(await code(organiser.client.events.cancel({ id: ofA.id }))).toBe("FORBIDDEN");
  });
});

describe("public events on WhatsApp (menu 8 → 4)", () => {
  it("register, full → waiting list, cancel → the next one moves up; organiser sees counts per language, never who", async () => {
    t = await makeE2E();
    const admin = await volunteer(t, { role: "admin" });
    const e = await admin.client.events.create(maraude({ kind: "info_session", title: "Réunion d'information sur l'asile", place: "12 rue des Lilas, Paris", date: "2026-11-12", startTime: "14:00", endTime: "16:00", public: true, publicSpots: 1 }));

    const p1 = t.phone("33616000001");
    await p1.say("1"); // Français
    await p1.say("8");
    await p1.say("4");
    const list = plain(await p1.last());
    expect(list).toContain(eventText("fr", "events_intro"));
    expect(list).toContain("1 - ℹ️ Réunion d'information sur l'asile · jeudi 12 novembre 2026 14:00");
    await p1.say("1");
    const detail = plain(await p1.last());
    expect(detail).toContain("📅 jeudi 12 novembre 2026 · 14:00–16:00");
    expect(detail).toContain("📍 12 rue des Lilas, Paris");
    expect(detail).toContain("👥 Places restantes : 1");
    expect(detail).toContain("1 - M'inscrire");
    await p1.say("1");
    const out1 = (await p1.out()).map(plain);
    expect(out1.some((m) => m.startsWith("✅ Vous êtes inscrit·e :") && m.includes("Réunion d'information sur l'asile"))).toBe(true);

    // Second person, in Arabic: translated, full → waiting list.
    const p2 = t.phone("33616000002");
    await p2.say("3"); // العربية
    await p2.say("8");
    await p2.say("4");
    expect(plain(await p2.last())).toContain("[ar]"); // FakeProvider tags translations
    await p2.say("1");
    expect(plain(await p2.last())).toContain(plain(eventText("ar", "events_actions_waitlist")).split("\n")[0]!);
    await p2.say("1");
    expect((await p2.out()).map(plain).some((m) => m.includes("(رقم 1)"))).toBe(true);

    const seen = await admin.client.events.get({ id: e.id });
    expect(seen).toMatchObject({ publicGoing: 1, publicWaiting: 1, publicLanguages: [{ language: "fr", count: 1 }] });
    expect(JSON.stringify(seen)).not.toContain("33616");
    // A volunteer who may not edit sees the totals but not the languages.
    const v = await volunteer(t);
    expect((await v.client.events.get({ id: e.id })).publicLanguages).toEqual([]);

    // p1 cancels from WhatsApp → p2 moves up and is told.
    await p1.say("8");
    await p1.say("4");
    expect(plain(await p1.last())).toContain("1 - ✅ ");
    await p1.say("1");
    await p1.say("2");
    expect((await p1.out()).map(plain)).toContain(eventText("fr", "events_left"));
    expect((await p2.out()).map(plain).some((m) => m.includes(plain(eventText("ar", "events_promoted", { summary: "" })).split("\n")[0]!))).toBe(true);
    expect(await admin.client.events.get({ id: e.id })).toMatchObject({ publicGoing: 1, publicWaiting: 0, publicLanguages: [{ language: "ar", count: 1 }] });
  });

  it("reminder the day before (exactly once), told when the time changes or the event is cancelled", async () => {
    t = await makeE2E();
    const admin = await volunteer(t, { role: "admin" });
    const e = await admin.client.events.create(maraude({ kind: "workshop", title: "Atelier français", date: "2026-11-12", startTime: "14:00", endTime: null, public: true }));
    const p = t.phone("33616000003");
    await p.say("1");
    await p.say("8");
    await p.say("4");
    await p.say("1");
    await p.say("1");
    const svc = getEvents(t.wdeps);
    expect((await svc.dispatch(new Date("2026-11-11T12:00:00Z"))).reminders).toBe(0); // 26 h before
    expect((await svc.dispatch(new Date("2026-11-11T13:15:00Z"))).reminders).toBe(1);
    expect((await svc.dispatch(new Date("2026-11-11T13:30:00Z"))).reminders).toBe(0);
    await t.queue.drain();
    expect(plain(await p.last())).toContain("Rappel, c'est demain :");

    await admin.client.events.update({ id: e.id, event: maraude({ kind: "workshop", title: "Atelier français", date: "2026-11-13", startTime: "10:00", endTime: null, public: true }) });
    await t.queue.drain();
    const changed = plain(await p.last());
    expect(changed).toContain("Cet événement a changé.");
    expect(changed).toContain("vendredi 13 novembre 2026 · 10:00");
    const bid = await beneficiaryIdOf(t, "33616000003");
    const [reg] = await t.deps.db.select().from(eventRegistrations).where(and(eq(eventRegistrations.eventId, e.id), eq(eventRegistrations.beneficiaryId, bid)));
    expect(reg!.remindedAt).toBeNull(); // new date: the reminder is due again

    await admin.client.events.cancel({ id: e.id });
    await t.queue.drain();
    expect(plain(await p.last())).toContain("Désolé, cet événement est annulé :");
    await p.say("8");
    await p.say("4");
    expect((await p.out()).slice(-2).map(plain)).toContain(eventText("fr", "events_none"));
  });

  it("team events are never offered on WhatsApp; 'delete my data' takes the person off", async () => {
    t = await makeE2E();
    const admin = await volunteer(t, { role: "admin" });
    await admin.client.events.create(maraude()); // team only
    const pub = await admin.client.events.create(maraude({ title: "Permanence juridique", kind: "info_session", public: true }));
    const p = t.phone("33616000004");
    await p.say("1");
    await p.say("8");
    await p.say("4");
    const list = plain(await p.last());
    expect(list).toContain("Permanence juridique");
    expect(list).not.toContain("Maraude");
    await p.say("1");
    await p.say("1");
    expect((await admin.client.events.get({ id: pub.id })).publicGoing).toBe(1);
    await p.say("9");
    await p.say("1");
    expect((await admin.client.events.get({ id: pub.id })).publicGoing).toBe(0);
  });
});
