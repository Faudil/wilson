import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { volunteers } from "../src/db/schema.js";
import { createVolunteer, makeClient, makeTestDeps, type TestCtx } from "./helpers.js";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

let t: TestCtx;
beforeAll(async () => {
  t = await makeTestDeps({ now: "2026-11-06T12:00:00Z" });
});
afterAll(() => t.close());

async function loggedIn(v: { email: string; password: string }) {
  const { client } = makeClient(t.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return client;
}

const SC = { name: "Secours Catholique", siren: "775666696", rna: "W751004076", city: "Paris (75)" };
const OTHER = { name: "Autre asso", siren: "123456789", rna: null, city: null };

/** Public sign-up, then the account row. */
async function signupRow(email: string, association: typeof SC | typeof OTHER | null, invitationToken?: string) {
  const { client } = makeClient(t.deps);
  await client.auth.signup({
    name: email.split("@")[0]!, email, password: "long-enough-pass", uiLanguage: "fr", acceptsConfidentiality: true,
    association: association ?? undefined, invitationToken,
  });
  const [row] = await t.deps.db.select().from(volunteers).where(eq(volunteers.email, email));
  return row;
}

describe("associations and association admins", () => {
  let admin: Awaited<ReturnType<typeof createVolunteer>>;
  let assoAdmin: Awaited<ReturnType<typeof createVolunteer>>;
  let scId: string;
  let otherId: string;
  let earlyId: string;

  beforeAll(async () => {
    admin = await createVolunteer(t.deps, { role: "admin", name: "Global Admin" });
    assoAdmin = await createVolunteer(t.deps, { name: "Fatima" });
  });

  it("a pending claim for an association not created yet is linked when the global admin creates it", async () => {
    const early = await signupRow("early@example.org", SC);
    earlyId = early!.id;
    expect(early!.associationId).toBeNull();
    const c = await loggedIn(admin);
    const a = await c.associations.create(SC);
    scId = a.id;
    expect(a.pendingCount).toBe(1);
    otherId = (await c.associations.create(OTHER)).id;
    expect(await code(c.associations.create({ ...SC, name: "Doublon" }))).toBe("CONFLICT");
  });

  it("only a global admin manages associations", async () => {
    const c = await loggedIn(assoAdmin);
    expect(await code(c.associations.list())).toBe("FORBIDDEN");
    expect(await code(c.associations.create(OTHER))).toBe("FORBIDDEN");
    // Without an association, a plain volunteer cannot see the volunteer list nor invite.
    expect(await code(c.volunteers.list({}))).toBe("FORBIDDEN");
    expect(await code(c.invitations.create({ role: "responder" }))).toBe("FORBIDDEN");
  });

  it("naming an association admin gives members.manage, scoped to that association", async () => {
    const c = await loggedIn(admin);
    const acc = await c.associations.setAdmin({ volunteerId: assoAdmin.id, associationId: scId, admin: true });
    expect(acc.memberOf).toEqual({ id: scId, name: SC.name });
    expect(acc.associationAdmin).toBe(true);
    expect(acc.permissions).toContain("members.manage");
    const me = await (await loggedIn(assoAdmin)).auth.me();
    expect(me.association).toEqual({ id: scId, name: SC.name });
    expect(me.associationAdmin).toBe(true);
    expect((await c.associations.list()).find((a) => a.id === scId)!.admins).toEqual([{ id: assoAdmin.id, name: "Fatima" }]);
  });

  it("a public sign-up picked from the register reaches that association's admin, and only theirs", async () => {
    const mine = await signupRow("mine@example.org", SC);
    const theirs = await signupRow("theirs@example.org", OTHER);
    const free = await signupRow("free@example.org", { name: SC.name, siren: null, rna: null, city: null } as never);
    expect(mine!.associationId).toBe(scId);
    expect(theirs!.associationId).toBe(otherId);
    // Typed by hand: no SIREN/RNA, so nothing proves it; it stays with the global admins.
    expect(free!.associationId).toBeNull();

    const c = await loggedIn(assoAdmin);
    const list = await c.volunteers.list({ status: "pending" });
    expect(list.map((a) => a.email).sort()).toEqual(["early@example.org", "mine@example.org"]);
    expect(await code(c.volunteers.approve({ id: theirs!.id, role: "volunteer" }))).toBe("NOT_FOUND");
    expect(await code(c.volunteers.reject({ id: free!.id }))).toBe("NOT_FOUND");
    expect(await code(c.volunteers.approve({ id: mine!.id, role: "admin" }))).toBe("FORBIDDEN");
    const ok = await c.volunteers.approve({ id: mine!.id, role: "volunteer" });
    expect(ok.status).toBe("active");
    expect(ok.approvedByName).toBe("Fatima");
    await c.volunteers.reject({ id: earlyId });
    // The global admin still sees everyone.
    const all = await (await loggedIn(admin)).volunteers.list({ status: "pending" });
    expect(all.map((a) => a.email).sort()).toEqual(["free@example.org", "theirs@example.org"]);
  });
  it("an association admin cannot hand out global-only rights or rights they lack", async () => {
    const c = await loggedIn(assoAdmin);
    const [member] = await t.deps.db.select().from(volunteers).where(eq(volunteers.email, "mine@example.org"));
    expect(await code(c.volunteers.setPermissions({ id: member!.id, overrides: [{ permission: "volunteers.manage", granted: true }] }))).toBe("FORBIDDEN");
    expect(await code(c.volunteers.setPermissions({ id: member!.id, overrides: [{ permission: "members.manage", granted: true }] }))).toBe("FORBIDDEN");
    expect(await code(c.volunteers.setPermissions({ id: member!.id, overrides: [{ permission: "usage.manage", granted: true }] }))).toBe("FORBIDDEN");
    // A right the association admin has (volunteer bundle) can be removed and given back.
    const less = await c.volunteers.setPermissions({ id: member!.id, overrides: [{ permission: "places.manage", granted: false }] });
    expect(less.permissions).not.toContain("places.manage");
    expect(await code(c.volunteers.setRole({ id: member!.id, role: "admin" }))).toBe("FORBIDDEN");
    // Global admins and fellow association admins are out of reach.
    expect(await code(c.volunteers.setDisabled({ id: admin.id, disabled: true }))).toBe("NOT_FOUND");
    const fellow = await createVolunteer(t.deps, { name: "Fellow" });
    await (await loggedIn(admin)).associations.setAdmin({ volunteerId: fellow.id, associationId: scId, admin: true });
    expect(await code(c.volunteers.setDisabled({ id: fellow.id, disabled: true }))).toBe("FORBIDDEN");
  });

  it("a global admin can take members.manage back from one association admin", async () => {
    const c = await loggedIn(admin);
    const fellow = (await c.volunteers.list({})).find((a) => a.name === "Fellow")!;
    const acc = await c.volunteers.setPermissions({ id: fellow.id, overrides: [{ permission: "members.manage", granted: false }] });
    expect(acc.associationAdmin).toBe(true);
    expect(acc.permissions).not.toContain("members.manage");
  });

  it("removing an association admin ends their sessions and their scoped access", async () => {
    const tmp = await createVolunteer(t.deps, { name: "Temp" });
    const g = await loggedIn(admin);
    await g.associations.setAdmin({ volunteerId: tmp.id, associationId: otherId, admin: true });
    const c = await loggedIn(tmp);
    expect(await code(c.volunteers.list({}))).toBe("ok");
    await g.associations.setAdmin({ volunteerId: tmp.id, associationId: otherId, admin: false });
    expect(await code(c.volunteers.list({}))).toBe("UNAUTHORIZED");
    expect(await code((await loggedIn(tmp)).volunteers.list({}))).toBe("FORBIDDEN");
  });
});

describe("invite links", () => {
  let admin: Awaited<ReturnType<typeof createVolunteer>>;
  let assoAdmin: Awaited<ReturnType<typeof createVolunteer>>;
  let assoId: string;

  beforeAll(async () => {
    admin = await createVolunteer(t.deps, { role: "admin", name: "Admin 2" });
    assoAdmin = await createVolunteer(t.deps, { name: "Karim" });
    const g = await loggedIn(admin);
    assoId = (await g.associations.create({ name: "Restos du coeur", siren: "339863417", rna: null, city: "Paris (75)" })).id;
    await g.associations.setAdmin({ volunteerId: assoAdmin.id, associationId: assoId, admin: true });
  });

  it("an association admin's invite creates an active member of their association, once", async () => {
    const c = await loggedIn(assoAdmin);
    expect(await code(c.invitations.create({ role: "admin" }))).toBe("FORBIDDEN");
    const { invitation, token } = await c.invitations.create({ role: "volunteer", label: "Sami, mardi", associationId: undefined });
    expect(invitation).toMatchObject({ association: { id: assoId, name: "Restos du coeur" }, role: "volunteer", status: "open", label: "Sami, mardi" });

    const anon = makeClient(t.deps).client;
    expect(await anon.auth.invitation({ token })).toEqual({ valid: true, associationName: "Restos du coeur", role: "volunteer" });

    const row = await signupRow("sami@example.org", null, token);
    expect(row).toMatchObject({ pendingApproval: false, role: "volunteer", associationId: assoId, approvedBy: assoAdmin.id });
    const sami = await loggedIn({ email: "sami@example.org", password: "long-enough-pass" });
    expect((await sami.auth.me()).association?.id).toBe(assoId);

    // Single use: a second sign-up with the same link is an ordinary pending request.
    const again = await signupRow("again@example.org", null, token);
    expect(again!.pendingApproval).toBe(true);
    expect(await anon.auth.invitation({ token })).toEqual({ valid: false, associationName: null, role: null });
    const [listed] = await c.invitations.list();
    expect(listed).toMatchObject({ status: "used", usedByName: "sami" });
    expect(await code(c.invitations.revoke({ id: listed!.id }))).toBe("CONFLICT");
  });

  it("revoked and expired links do nothing; links still work when public sign-up is off", async () => {
    const c = await loggedIn(assoAdmin);
    const revoked = await c.invitations.create({ role: "responder" });
    await c.invitations.revoke({ id: revoked.invitation.id });
    const r = await signupRow("revoked@example.org", null, revoked.token);
    expect(r!.pendingApproval).toBe(true);

    const expiring = await c.invitations.create({ role: "responder" });
    t.clock.set("2026-11-14T12:00:01Z");
    try {
      const later = await loggedIn(assoAdmin); // the earlier session expired with the clock jump
      expect((await later.invitations.list()).find((i) => i.id === expiring.invitation.id)!.status).toBe("expired");
      const e = await signupRow("expired@example.org", null, expiring.token);
      expect(e!.pendingApproval).toBe(true);
    } finally {
      t.clock.set("2026-11-06T12:00:00Z");
    }

    const closed = await makeTestDeps({ config: { VOLUNTEER_SIGNUP: "off" } });
    try {
      const a = await createVolunteer(closed.deps, { role: "admin" });
      const { client } = makeClient(closed.deps);
      await client.auth.login({ email: a.email, password: a.password });
      const { token } = await client.invitations.create({ role: "responder" });
      const anon = makeClient(closed.deps).client;
      const base = { name: "Closed", password: "long-enough-pass", uiLanguage: "fr" as const, acceptsConfidentiality: true as const };
      expect(await code(anon.auth.signup({ ...base, email: "nope@example.org" }))).toBe("FORBIDDEN");
      expect(await code(anon.auth.signup({ ...base, email: "yes@example.org", invitationToken: token }))).toBe("ok");
      const [row] = await closed.deps.db.select().from(volunteers).where(eq(volunteers.email, "yes@example.org"));
      expect(row).toMatchObject({ pendingApproval: false, role: "responder", associationId: null });
    } finally {
      await closed.close();
    }
  });

  it("an association admin only sees and revokes their own association's invites", async () => {
    const g = await loggedIn(admin);
    const global = await g.invitations.create({ role: "admin" });
    expect(global.invitation.association).toBeNull();
    const c = await loggedIn(assoAdmin);
    expect((await c.invitations.list()).some((i) => i.id === global.invitation.id)).toBe(false);
    expect(await code(c.invitations.revoke({ id: global.invitation.id }))).toBe("NOT_FOUND");
  });
});
