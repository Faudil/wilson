import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { accessLog, beneficiaries, sessions, volunteers } from "../src/db/schema.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");
const signupInput = (email: string) => ({
  name: "Amina Nouvelle", email, password: "bien-long-mot-de-passe", uiLanguage: "fr" as const,
  note: "Je parle arabe et dari, disponible le soir.", acceptsConfidentiality: true as const,
});

async function adminClient(e: E2E) {
  const a = await createVolunteer(e.deps, { role: "admin", name: "Admin Test" });
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: a.email, password: a.password });
  return { admin: a, client };
}

describe("volunteer self-signup", () => {
  it("signup → pending (cannot log in) → admin approves as responder → conversations only", async () => {
    t = await makeE2E();
    const anon = makeClient(t.deps);
    expect(await anon.client.auth.signup(signupInput("Amina@Example.org"))).toEqual({ ok: true });

    // right password, not approved yet → FORBIDDEN (wrong password stays UNAUTHORIZED); no session created
    expect(await code(anon.client.auth.login({ email: "amina@example.org", password: "bien-long-mot-de-passe" }))).toBe("FORBIDDEN");
    expect(await code(anon.client.auth.login({ email: "amina@example.org", password: "mauvais-mot-de-passe" }))).toBe("UNAUTHORIZED");
    expect(anon.jar.token).toBeNull();
    expect(await t.deps.db.select().from(sessions)).toHaveLength(1); // only the e2e helper's volunteer

    const { client: admin, admin: a } = await adminClient(t);
    const pending = await admin.volunteers.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ email: "amina@example.org", name: "Amina Nouvelle", status: "pending", note: "Je parle arabe et dari, disponible le soir." });

    const approved = await admin.volunteers.approve({ id: pending[0]!.id });
    expect(approved).toMatchObject({ status: "active", role: "responder", approvedByName: "Admin Test" });
    expect(approved.approvedAt).not.toBeNull();
    const logged = await t.deps.db.select().from(accessLog).where(and(eq(accessLog.volunteerId, a.id), eq(accessLog.targetId, approved.id)));
    expect(logged.map((l) => l.action)).toEqual(["volunteers.approve:responder"]);

    const me = await anon.client.auth.login({ email: "amina@example.org", password: "bien-long-mot-de-passe" });
    expect(me.role).toBe("responder");
    expect(me.permissions.sort()).toEqual(["conversations.reply", "conversations.view", "knowledge.view", "places.view", "skills.edit_own"]);
    expect(await code(anon.client.conversations.list({ filter: "all", limit: 5 }))).toBe("ok");
    expect(await code(anon.client.letters.list({ limit: 5 }))).toBe("FORBIDDEN");
    expect(await code(anon.client.beneficiaries.list({ limit: 5 }))).toBe("FORBIDDEN");
    expect(await code(anon.client.volunteers.list({}))).toBe("FORBIDDEN");

    // promote to the full volunteer bundle: applies on the next request, no new login needed
    await admin.volunteers.setRole({ id: approved.id, role: "volunteer" });
    expect(await code(anon.client.letters.list({ limit: 5 }))).toBe("ok");
  });

  it("an existing email gets the same answer and changes nothing; refusing deletes the request", async () => {
    t = await makeE2E();
    const existing = await createVolunteer(t.deps, { email: "deja@example.org", name: "Déjà Là" });
    const anon = makeClient(t.deps).client;
    expect(await anon.auth.signup(signupInput("deja@example.org"))).toEqual({ ok: true });
    const [row] = await t.deps.db.select().from(volunteers).where(eq(volunteers.email, "deja@example.org"));
    expect(row).toMatchObject({ id: existing.id, name: "Déjà Là", pendingApproval: false });

    await anon.auth.signup(signupInput("spam@example.org"));
    const { client: admin } = await adminClient(t);
    const [req] = await admin.volunteers.list({ status: "pending" });
    await admin.volunteers.reject({ id: req!.id });
    expect(await t.deps.db.select().from(volunteers).where(eq(volunteers.email, "spam@example.org"))).toHaveLength(0);
    expect(await code(admin.volunteers.reject({ id: existing.id }))).toBe("CONFLICT");
  });

  it("signup can be turned off, and the pending list is capped", async () => {
    t = await makeE2E({ config: { VOLUNTEER_SIGNUP: "off" } });
    expect(await code(makeClient(t.deps).client.auth.signup(signupInput("x@example.org")))).toBe("FORBIDDEN");
    expect((await makeClient(t.deps).client.system.health()).signup).toBe(false);
    await t.close();

    t = await makeE2E({ config: { VOLUNTEER_SIGNUP_MAX_PENDING: "2" } });
    const anon = makeClient(t.deps).client;
    await anon.auth.signup(signupInput("a1@example.org"));
    await anon.auth.signup(signupInput("a2@example.org"));
    await expect(anon.auth.signup(signupInput("a3@example.org"))).rejects.toMatchObject({ code: "CONFLICT", data: { reason: "too_many_pending" } });
    expect(await code(anon.auth.signup({ ...signupInput("a4@example.org"), acceptsConfidentiality: false } as never))).toBe("BAD_REQUEST");
  });

  it("disabling revokes sessions at once and releases held conversations; admins cannot disable or demote themselves", async () => {
    t = await makeE2E({ config: { CHAT_MODE: "review" } });
    const v = await createVolunteer(t.deps, { email: "partant@example.org" });
    const vc = makeClient(t.deps);
    await vc.client.auth.login({ email: v.email, password: v.password });
    const p = t.phone("33620000101");
    await p.say("?");
    await p.say("2");
    const bid = await beneficiaryIdOf(t, "33620000101");
    await vc.client.conversations.takeOver({ beneficiaryId: bid });

    const { client: admin, admin: a } = await adminClient(t);
    expect((await admin.volunteers.setDisabled({ id: v.id, disabled: true })).status).toBe("disabled");
    expect(await code(vc.client.auth.me())).toBe("UNAUTHORIZED");
    const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b).toMatchObject({ chatAssigneeId: null, chatStatus: "needs_human" });

    await expect(admin.volunteers.setDisabled({ id: a.id, disabled: true })).rejects.toMatchObject({ code: "CONFLICT", data: { reason: "self" } });
    await expect(admin.volunteers.setRole({ id: a.id, role: "volunteer" })).rejects.toMatchObject({ code: "CONFLICT", data: { reason: "self" } });
    expect((await admin.volunteers.setDisabled({ id: v.id, disabled: false })).status).toBe("active");
  });
});

describe("volunteer takes a conversation over", () => {
  async function arabicSpeaker(phone: string) {
    t = await makeE2E({ config: { CHAT_MODE: "review" } });
    const p = t.phone(phone);
    await p.say("?");
    await p.say(String(LANGUAGE_CODES.indexOf("ar") + 1));
    await p.say("4");
    return { p, bid: await beneficiaryIdOf(t, phone) };
  }

  it("take over → beneficiary told once → bot silent → French reply translated → close gives it back to the bot", async () => {
    const { p, bid } = await arabicSpeaker("33620000102");
    const conv = await t!.client.conversations.takeOver({ beneficiaryId: bid });
    expect(conv.status).toBe("with_volunteer");
    expect(conv.assignee).toMatchObject({ name: "Test Volunteer" });
    expect(plain(await p.last())).toContain(plain(waText("ar", "chat_handoff")));

    // taking it again is a no-op (no second notice)
    const before = (await p.out()).length;
    await t!.client.conversations.takeOver({ beneficiaryId: bid });
    expect((await p.out()).length).toBe(before);

    // the beneficiary writes: stored with a French translation, no bot draft, no "pending" notice
    await p.say("أين المحافظة؟");
    expect((await p.out()).length).toBe(before);
    let c = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(c.messages.filter((m) => m.state === "draft")).toHaveLength(0);
    expect(c.messages.at(-1)).toMatchObject({ author: "beneficiary", textFr: "[fr] أين المحافظة؟" });
    expect(c.awaitingReply).toBe(true);
    const mine = await t!.client.conversations.list({ filter: "mine", limit: 10 });
    expect(mine.items.map((i) => i.beneficiaryId)).toEqual([bid]);
    expect((await t!.client.conversations.list({ filter: "attention", limit: 10 })).items.map((i) => i.beneficiaryId)).toEqual([bid]);
    expect((await t!.client.conversations.attentionCount()).count).toBe(1);

    // the volunteer answers in French; the person receives Arabic + footer
    c = await t!.client.conversations.reply({ beneficiaryId: bid, textFr: "La préfecture est au 1 rue de la Paix." });
    await t!.queue.drain();
    expect(plain(await p.last())).toContain("[ar] La préfecture est au 1 rue de la Paix.");
    expect(c.awaitingReply).toBe(false);
    expect((await t!.client.conversations.list({ filter: "attention", limit: 10 })).items).toHaveLength(0);
    expect((await t!.client.conversations.attentionCount()).count).toBe(0);

    // an emergency still gets the fixed emergency numbers at once
    await p.say("urgence, je dois dormir dehors");
    expect(plain(await p.last())).toContain("115");

    // close: assignee cleared; the next question goes to the bot again
    c = await t!.client.conversations.resolve({ beneficiaryId: bid });
    expect(c).toMatchObject({ status: "resolved", assignee: null });
    await p.say("Where is the CAF?");
    c = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(c.messages.some((m) => m.state === "draft")).toBe(true);
  });

  it("another volunteer gets CONFLICT unless forcing; replying takes an unassigned conversation over", async () => {
    const { bid } = await arabicSpeaker("33620000103");
    const other = await createVolunteer(t!.deps, { name: "Autre Bénévole" });
    const oc = makeClient(t!.deps).client;
    await oc.auth.login({ email: other.email, password: other.password });

    const r = await oc.conversations.reply({ beneficiaryId: bid, textFr: "Bonjour, je suis là." });
    expect(r).toMatchObject({ status: "with_volunteer", assignee: { id: other.id, name: "Autre Bénévole" } });
    await expect(t!.client.conversations.takeOver({ beneficiaryId: bid })).rejects.toMatchObject({ code: "CONFLICT", data: { reason: "assigned" } });
    const forced = await t!.client.conversations.takeOver({ beneficiaryId: bid, force: true });
    expect(forced.assignee?.name).toBe("Test Volunteer");
    expect((await oc.conversations.list({ filter: "mine", limit: 10 })).items).toHaveLength(0);
    const logged = await t!.deps.db.select().from(accessLog).where(eq(accessLog.action, "conversations.take_over_forced"));
    expect(logged).toHaveLength(1);
  });
});

describe("per-volunteer permissions (admin editor)", () => {
  it("grants and revokes single permissions on top of the role, applied on the next request, logged", async () => {
    t = await makeE2E();
    const { client: admin, admin: a } = await adminClient(t);
    const v = await createVolunteer(t.deps, { name: "Bénévole" });
    const { client: vc } = makeClient(t.deps);
    await vc.auth.login({ email: v.email, password: v.password });
    expect(await code(vc.places.create({ kind: "food", name: "Repas", startsOn: "2026-11-06" }))).toBe("ok");
    expect(await code(vc.broadcasts.approve({ id: v.id }))).toBe("FORBIDDEN");

    // revoke places.manage, grant broadcasts.approve; an override equal to the role default is dropped
    const acc = await admin.volunteers.setPermissions({
      id: v.id,
      overrides: [{ permission: "places.manage", granted: false }, { permission: "broadcasts.approve", granted: true }, { permission: "places.view", granted: true }],
    });
    expect(acc.overrides).toEqual([{ permission: "broadcasts.approve", granted: true }, { permission: "places.manage", granted: false }]);
    expect(acc.permissions).toContain("broadcasts.approve");
    expect(acc.permissions).not.toContain("places.manage");
    expect(await code(vc.places.create({ kind: "food", name: "Repas", startsOn: "2026-11-06" }))).toBe("FORBIDDEN");
    expect(await code(vc.places.list({ scope: "today" }))).toBe("ok");
    expect(await code(vc.broadcasts.approve({ id: v.id }))).toBe("NOT_FOUND"); // allowed now; no such announcement
    expect((await vc.auth.me()).permissions).toContain("broadcasts.approve");

    const logged = await t.deps.db.select().from(accessLog).where(and(eq(accessLog.volunteerId, a.id), eq(accessLog.targetId, v.id)));
    expect(logged.map((l) => l.action)).toEqual(["volunteers.set_permissions:-places.manage,+broadcasts.approve"]);

    // listed for the admin with the overrides; back to the role defaults with an empty list
    const listed = (await admin.volunteers.list({})).find((x) => x.id === v.id)!;
    expect(listed.overrides).toHaveLength(2);
    const reset = await admin.volunteers.setPermissions({ id: v.id, overrides: [] });
    expect(reset.overrides).toEqual([]);
    expect(await code(vc.places.create({ kind: "food", name: "Repas", startsOn: "2026-11-06" }))).toBe("ok");
  });

  it("not on yourself, not on a pending account, admins only", async () => {
    t = await makeE2E();
    const { client: admin, admin: a } = await adminClient(t);
    expect(await code(admin.volunteers.setPermissions({ id: a.id, overrides: [] }))).toBe("CONFLICT");
    const anon = makeClient(t.deps);
    await anon.client.auth.signup(signupInput("pending@example.org"));
    const [pending] = await admin.volunteers.list({ status: "pending" });
    expect(pending!.permissions).toEqual([]); // nothing until approved
    expect(await code(admin.volunteers.setPermissions({ id: pending!.id, overrides: [] }))).toBe("CONFLICT");
    // a plain volunteer cannot give themselves (or anyone) rights
    expect(await code(t.client.volunteers.setPermissions({ id: pending!.id, overrides: [{ permission: "volunteers.manage", granted: true }] }))).toBe("FORBIDDEN");
  });
});
