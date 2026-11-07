import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { ROLE_PERMISSIONS, type Permission } from "@wilson/contracts";
import { buddyText } from "@wilson/i18n";
import { nextOccurrence } from "../src/buddies/service.js";
import { accessLog, buddyMatches, volunteerPermissions, volunteers } from "../src/db/schema.js";
import { JOBS } from "../src/jobs/names.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { makeE2E, type Client, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");
/** Tests move the clock by days: keep the sessions alive. */
const LONG = { config: { SESSION_TTL_HOURS: "2000" } };
const BUDDY: Permission[] = ["buddies.be_buddy", "buddies.manage", "buddies.reports"];
const PROFILE = { active: true, languages: ["ar" as const], slots: [{ weekday: 2, time: "18:30" }], modes: ["meet" as const, "call" as const], maxBuddies: 2, meetPlace: "Local de l'association, 12 rue Exemple" };

async function login(e: E2E, opts: { role?: "responder" | "volunteer" | "admin"; name?: string; grant?: Permission[]; revoke?: Permission[] } = {}) {
  const v = await createVolunteer(e.deps, { role: opts.role === "admin" ? "admin" : "volunteer", name: opts.name ?? "Marie Dupont" });
  if (opts.role === "responder") await e.deps.db.update(volunteers).set({ role: "responder" }).where(eq(volunteers.id, v.id));
  for (const p of opts.grant ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: true });
  for (const p of opts.revoke ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: p, granted: false });
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return { id: v.id, client };
}

/** A French-speaking beneficiary asks for a buddy: evenings, in person or by call. */
async function ask(e: E2E, number = "33612000001", mode: "1" | "2" | "3" = "3") {
  const p = e.phone(number);
  await p.say("1"); // language menu → Français
  await p.say("7");
  expect(plain(await p.last())).toContain("Quand êtes-vous disponible ?");
  await p.say("3"); // weekday evenings
  await p.say(mode);
  expect(await p.last()).toBe(`${buddyText("fr", "buddy_requested")}`);
  return p;
}

/** Request → volunteer proposes themself (Tuesday 18:30, in person) → beneficiary accepts. */
async function pair(e: E2E, buddy: Client, number = "33612000001", mode: "call" | "meet" = "meet") {
  const p = await ask(e, number);
  await buddy.buddies.saveProfile(PROFILE);
  const [req] = await buddy.buddies.requests();
  const m = await buddy.buddies.propose({ requestId: req!.id, weekday: 2, time: "18:30", mode });
  expect(plain(await p.last())).toContain(plain(buddyText("fr", "buddy_found")));
  await p.say("7");
  expect(plain(await p.last())).toContain("Binôme de français : ");
  await p.say("1");
  return { p, matchId: m.id, requestId: req!.id };
}

describe("buddy permissions: defaults per role", () => {
  it("responder none, volunteer be_buddy only, admin all three", async () => {
    expect(ROLE_PERMISSIONS.responder.filter((p) => BUDDY.includes(p))).toEqual([]);
    expect(ROLE_PERMISSIONS.volunteer.filter((p) => BUDDY.includes(p))).toEqual(["buddies.be_buddy"]);
    expect(ROLE_PERMISSIONS.admin.filter((p) => BUDDY.includes(p)).sort()).toEqual([...BUDDY].sort());
  });
});

describe("buddy permissions: enforced on the server", () => {
  it("a responder is refused every buddies procedure; granting be_buddy opens only the buddy ones", async () => {
    t = await makeE2E(LONG);
    const { client: r } = await login(t, { role: "responder" });
    const id = "00000000-0000-4000-8000-000000000000";
    for (const call of [
      () => r.buddies.myProfile(), () => r.buddies.saveProfile(PROFILE), () => r.buddies.requests(), () => r.buddies.candidates({ requestId: id }),
      () => r.buddies.propose({ requestId: id, weekday: 1, time: "10:00", mode: "call" }), () => r.buddies.mine(), () => r.buddies.all({}),
      () => r.buddies.get({ id }), () => r.buddies.sendMessage({ matchId: id, text: "x" }), () => r.buddies.skipSession({ sessionId: id }),
      () => r.buddies.end({ matchId: id }), () => r.buddies.contact({ matchId: id }), () => r.buddies.report({ matchId: id, text: "xxx" }),
      () => r.buddies.reports({}), () => r.buddies.resolveReport({ id, action: "end" }), () => r.buddies.counts(),
    ]) expect(await code(call())).toBe("FORBIDDEN");

    const { client: g } = await login(t, { role: "responder", grant: ["buddies.be_buddy"] });
    expect(await code(g.buddies.saveProfile(PROFILE))).toBe("ok");
    expect(await code(g.buddies.mine())).toBe("ok");
    expect(await code(g.buddies.all({}))).toBe("FORBIDDEN");
    expect(await code(g.buddies.reports({}))).toBe("FORBIDDEN");
    expect(await code(g.buddies.candidates({ requestId: id }))).toBe("FORBIDDEN");
  });

  it("be_buddy proposes only themself; manage proposes others; a revoked be_buddy cannot be proposed", async () => {
    t = await makeE2E(LONG);
    await ask(t);
    const { id: aliceId, client: alice } = await login(t, { name: "Alice Martin" });
    const { id: bobId, client: bob } = await login(t, { name: "Bob Durand", revoke: ["buddies.be_buddy"] });
    const { client: coord } = await login(t, { name: "Chloé Coord", role: "volunteer", grant: ["buddies.manage"] });
    await alice.buddies.saveProfile(PROFILE);
    expect(await code(bob.buddies.saveProfile(PROFILE))).toBe("FORBIDDEN");
    await t.deps.db.insert((await import("../src/db/schema.js")).buddyProfiles).values({ volunteerId: bobId, modes: ["meet"], slots: [], languages: [] });
    const [req] = await alice.buddies.requests();
    expect(req!.beneficiaryLabel).not.toMatch(/\d{4}/); // masked, no phone number
    expect(await code(alice.buddies.propose({ requestId: req!.id, volunteerId: bobId, weekday: 2, time: "18:30", mode: "meet" }))).toBe("FORBIDDEN");
    expect(await code(alice.buddies.candidates({ requestId: req!.id }))).toBe("FORBIDDEN");

    const cands = await coord.buddies.candidates({ requestId: req!.id });
    expect(cands.map((c) => c.volunteerId)).toEqual([aliceId]); // Bob has no be_buddy any more: not a candidate
    expect(cands[0]).toMatchObject({ freeSpots: 2, matchingSlots: [{ weekday: 2, time: "18:30" }] });
    expect(await code(coord.buddies.propose({ requestId: req!.id, volunteerId: bobId, weekday: 2, time: "18:30", mode: "meet" }))).toBe("CONFLICT");
    expect(await code(coord.buddies.propose({ requestId: req!.id, volunteerId: aliceId, weekday: 2, time: "18:30", mode: "meet" }))).toBe("ok");
    expect(await code(coord.buddies.propose({ requestId: req!.id, volunteerId: aliceId, weekday: 2, time: "18:30", mode: "meet" }))).toBe("CONFLICT");
  });

  it("another buddy cannot touch my pairing; manage sees it without messages; contact needs consent", async () => {
    t = await makeE2E(LONG);
    const { client: marie } = await login(t);
    const { client: other } = await login(t, { name: "Paul Autre" });
    const { client: coord } = await login(t, { name: "Chloé Coord", grant: ["buddies.manage"] });
    const { p, matchId } = await pair(t, marie, "33612000001", "call");
    expect(plain(await p.last())).toContain("a besoin de votre numéro");
    await p.say("2"); // keep the number private
    expect(plain((await p.out()).at(-2)!)).toContain("votre numéro reste privé");

    const detail = await marie.buddies.get({ id: matchId });
    expect(detail.status).toBe("active");
    for (const call of [
      () => other.buddies.get({ id: matchId }), () => other.buddies.sendMessage({ matchId, text: "salut" }), () => other.buddies.contact({ matchId }),
      () => other.buddies.end({ matchId }), () => other.buddies.report({ matchId, text: "pas moi" }), () => other.buddies.skipSession({ sessionId: detail.nextSession!.id }),
      () => coord.buddies.contact({ matchId }), () => coord.buddies.sendMessage({ matchId, text: "x" }),
    ]) expect(await code(call())).toBe("FORBIDDEN");
    expect((await coord.buddies.get({ id: matchId })).messages).toBeNull();
    expect((await coord.buddies.all({ status: "active" })).map((m) => m.id)).toEqual([matchId]);

    expect(await code(marie.buddies.contact({ matchId }))).toBe("FORBIDDEN"); // said no
    await p.say("7");
    await p.say("3"); // my phone number → asks again
    await p.say("1");
    expect(plain(await p.last())).toContain("peut maintenant voir votre numéro");
    expect(await marie.buddies.contact({ matchId })).toEqual({ phone: "+33612000001" });
    const logged = await t.deps.db.select().from(accessLog).where(and(eq(accessLog.action, "buddies.contact"), eq(accessLog.targetId, matchId)));
    expect(logged).toHaveLength(1);
    await p.say("7");
    await p.say("3"); // stop sharing
    expect(plain(await p.last())).toContain("n'est plus partagé");
    expect(await code(marie.buddies.contact({ matchId }))).toBe("FORBIDDEN");
  });
});

describe("buddy flow on WhatsApp", () => {
  it("request → proposal → accept → weekly session, reminder once the day before → relayed messages", async () => {
    t = await makeE2E(LONG); // Friday 6 Nov 2026, 13:00 in Paris
    const { client: marie } = await login(t);
    const { p, matchId } = await pair(t, marie);
    expect(plain(await p.last())).toContain("Votre binôme de français est Marie. Premier rendez-vous : mardi 10 novembre 2026 à 18:30");

    const [m] = await marie.buddies.mine();
    expect(m).toMatchObject({ id: matchId, status: "active", mode: "meet", place: PROFILE.meetPlace, contactShared: false });
    expect(m!.nextSession!.startsAt).toBe("2026-11-10T17:30:00.000Z");
    expect((await marie.buddies.requests())).toHaveLength(0); // matched requests leave the list

    // Reminder: nothing on Sunday, once on Monday evening (< 24 h before), not twice.
    const before = (await p.out()).length;
    t.clock.set("2026-11-08T12:00:00Z");
    await t.deps.jobs.send(JOBS.buddyDispatch, {});
    await t.queue.drain();
    expect((await p.out()).length).toBe(before);
    t.clock.set("2026-11-09T18:00:00Z");
    for (let i = 0; i < 2; i++) {
      await t.deps.jobs.send(JOBS.buddyDispatch, {});
      await t.queue.drain();
    }
    expect((await p.out()).length).toBe(before + 1);
    expect(plain(await p.last())).toContain("Rappel : français avec Marie, mardi 10 novembre 2026 à 18:30. Lieu du rendez-vous : Local de l'association");

    // After the session: the next one is a week later.
    t.clock.set("2026-11-11T09:00:00Z");
    await t.deps.jobs.send(JOBS.buddyDispatch, {});
    await t.queue.drain();
    expect((await marie.buddies.get({ id: matchId })).nextSession!.startsAt).toBe("2026-11-17T17:30:00.000Z");

    // Messages through Wilson, both ways.
    await p.say("7");
    await p.say("1");
    await p.say("Bonjour Marie, à mardi !");
    expect(plain(await p.last())).toBe(plain(buddyText("fr", "buddy_message_sent", { name: "Marie" })));
    await marie.buddies.sendMessage({ matchId, text: "Avec plaisir, à mardi." });
    expect(plain(await p.last())).toContain("Message de Marie, votre binôme de français :\nAvec plaisir, à mardi.");
    expect((await marie.buddies.get({ id: matchId })).messages!.map((x) => [x.author, x.text])).toEqual([
      ["beneficiary", "Bonjour Marie, à mardi !"], ["volunteer", "Avec plaisir, à mardi."],
    ]);

    // Skips: the beneficiary skips the next one; the volunteer skips the one after (the person is told).
    await p.say("7");
    await p.say("2");
    expect(plain(await p.last())).toContain("le rendez-vous du mardi 17 novembre 2026 est annulé");
    const d = await marie.buddies.get({ id: matchId });
    expect(d.nextSession!.startsAt).toBe("2026-11-24T17:30:00.000Z");
    await marie.buddies.skipSession({ sessionId: d.nextSession!.id });
    expect(plain(await p.last())).toContain("Marie ne peut pas venir le mardi 24 novembre 2026");

    // Stop from WhatsApp: the pairing ends, the buddy loses access to messaging.
    await p.say("7");
    await p.say("4");
    await p.say("1");
    expect(plain(await p.last())).toBe(plain(buddyText("fr", "buddy_stopped")));
    expect((await marie.buddies.get({ id: matchId })).status).toBe("ended");
    expect(await code(marie.buddies.sendMessage({ matchId, text: "?" }))).toBe("CONFLICT");
  });

  it("decline keeps the request waiting; cancel removes it; a proposal expires after 7 days", async () => {
    t = await makeE2E(LONG);
    const { client: marie } = await login(t);
    const p = await ask(t);
    await marie.buddies.saveProfile(PROFILE);
    const [req] = await marie.buddies.requests();
    await marie.buddies.propose({ requestId: req!.id, weekday: 2, time: "18:30", mode: "meet" });
    expect((await marie.buddies.requests())[0]!.proposed).toBe(true);
    await p.say("7");
    await p.say("2"); // no thanks
    expect(plain(await p.last())).toBe(plain(buddyText("fr", "buddy_declined")));
    expect((await marie.buddies.requests())[0]).toMatchObject({ id: req!.id, proposed: false });

    await marie.buddies.propose({ requestId: req!.id, weekday: 4, time: "19:00", mode: "meet" });
    t.clock.set("2026-11-14T12:00:00Z");
    await t.deps.jobs.send(JOBS.buddyDispatch, {});
    await t.queue.drain();
    expect((await marie.buddies.mine()).map((m) => m.status)).toEqual(["declined", "declined"]);

    await p.say("7");
    expect(plain(await p.last())).toContain("Vous êtes sur la liste d'attente");
    await p.say("2");
    expect(plain(await p.last())).toBe(plain(buddyText("fr", "buddy_cancelled")));
    expect(await marie.buddies.requests()).toHaveLength(0);
  });

  it("a report pauses the pairing (no reminder); only buddies.reports reads it and the messages; resume tells the person", async () => {
    t = await makeE2E(LONG);
    const { client: marie } = await login(t);
    const { client: coord } = await login(t, { name: "Chloé Coord", grant: ["buddies.manage"] });
    const { client: admin } = await login(t, { role: "admin", name: "Ada Admin" });
    const { p, matchId } = await pair(t, marie);
    await p.say("7");
    await p.say("1");
    await p.say("Est-ce qu'on peut se voir chez toi ?");
    await p.say("7");
    await p.say("5");
    await p.say("Le bénévole m'a demandé de l'argent.");
    expect(plain(await p.last())).toContain("Le binôme est en pause");
    expect((await marie.buddies.get({ id: matchId })).status).toBe("suspended");
    expect(await code(marie.buddies.sendMessage({ matchId, text: "?" }))).toBe("CONFLICT");

    const before = (await p.out()).length;
    t.clock.set("2026-11-09T18:00:00Z");
    await t.deps.jobs.send(JOBS.buddyDispatch, {});
    await t.queue.drain();
    expect((await p.out()).length).toBe(before); // no reminder while suspended

    expect(await code(coord.buddies.reports({}))).toBe("FORBIDDEN");
    expect(await code(marie.buddies.reports({}))).toBe("FORBIDDEN");
    expect((await coord.buddies.get({ id: matchId })).messages).toBeNull();
    const [rep] = await admin.buddies.reports({});
    expect(rep).toMatchObject({ matchId, by: "beneficiary", text: "Le bénévole m'a demandé de l'argent.", status: "open", volunteerName: "Marie Dupont" });
    expect((await admin.buddies.get({ id: matchId })).messages!.map((m) => m.text)).toEqual(["Est-ce qu'on peut se voir chez toi ?"]);
    expect(await t.deps.db.select().from(accessLog).where(and(eq(accessLog.action, "buddies.view_messages"), eq(accessLog.targetId, matchId)))).toHaveLength(1);
    expect((await admin.buddies.counts()).openReports).toBe(1);
    expect(await coord.buddies.counts()).toEqual({ waiting: 0, openReports: 0 });

    const done = await admin.buddies.resolveReport({ id: rep!.id, action: "resume", note: "Malentendu, appelé les deux." });
    expect(done).toMatchObject({ status: "closed", resolution: "resumed", note: "Malentendu, appelé les deux.", handledByName: "Ada Admin" });
    expect((await marie.buddies.get({ id: matchId })).status).toBe("active");
    expect(plain(await p.last())).toContain("Votre binôme avec Marie continue");
  });

  it("a volunteer's report pauses it and tells the person; disabling a buddy ends their pairings; deleting my data ends mine", async () => {
    t = await makeE2E(LONG);
    const { id: marieId, client: marie } = await login(t);
    const { client: admin } = await login(t, { role: "admin", name: "Ada Admin" });
    const a = await pair(t, marie, "33612000001");
    await marie.buddies.report({ matchId: a.matchId, text: "Propos inquiétants, à rappeler." });
    expect(plain(await a.p.last())).toContain("Votre binôme avec Marie est en pause");
    const [rep] = await admin.buddies.reports({});
    await admin.buddies.resolveReport({ id: rep!.id, action: "end" });
    expect((await marie.buddies.get({ id: a.matchId })).status).toBe("ended");
    expect(plain(await a.p.last())).toContain("Votre binôme avec Marie est terminé");

    const b = await pair(t, marie, "33612000002");
    await admin.volunteers.setDisabled({ id: marieId, disabled: true });
    const [row] = await t.deps.db.select().from(buddyMatches).where(eq(buddyMatches.id, b.matchId));
    expect(row).toMatchObject({ status: "ended", endedBy: "coordinator" });
    expect(plain(await b.p.last())).toContain("Votre binôme avec Marie est terminé");

    const { client: lea } = await login(t, { name: "Léa Neuve" });
    const c = await pair(t, lea, "33612000003");
    await c.p.say("9");
    await c.p.say("1");
    expect((await lea.buddies.get({ id: c.matchId })).status).toBe("ended");
  });
});

describe("nextOccurrence", () => {
  it("weekly wall-clock time across the DST change, strictly after the given instant", () => {
    const tz = "Europe/Paris";
    // Tuesday 18:30 Paris: UTC+2 in summer, UTC+1 after 25 Oct 2026.
    expect(nextOccurrence(2, "18:30", new Date("2026-10-21T12:00:00Z"), tz).toISOString()).toBe("2026-10-27T17:30:00.000Z");
    expect(nextOccurrence(2, "18:30", new Date("2026-10-13T12:00:00Z"), tz).toISOString()).toBe("2026-10-13T16:30:00.000Z");
    expect(nextOccurrence(2, "18:30", new Date("2026-10-13T16:30:00Z"), tz).toISOString()).toBe("2026-10-20T16:30:00.000Z");
    expect(nextOccurrence(7, "10:00", new Date("2026-11-06T12:00:00Z"), tz).toISOString()).toBe("2026-11-08T09:00:00.000Z");
  });
});
