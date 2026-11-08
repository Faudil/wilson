import { afterEach, describe, expect, it } from "bun:test";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { eq } from "drizzle-orm";
import { recentAlerts } from "../src/alerts.js";
import { dispatchWaitingAlert } from "../src/chat/waiting.js";
import { beneficiaries, messages, sessions } from "../src/db/schema.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

async function person(e: E2E, phone: string) {
  const p = e.phone(phone);
  await p.say("bonjour");
  await p.say(String(LANGUAGE_CODES.indexOf("fr") + 1));
  return { p, bid: await beneficiaryIdOf(e, phone) };
}

describe("password reset link", () => {
  it("an admin creates a one-time link; it sets a new password, closes every session and cannot be reused", async () => {
    t = await makeE2E();
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client: a } = makeClient(t.deps);
    await a.auth.login({ email: admin.email, password: admin.password });
    const v = await createVolunteer(t.deps);
    const { client: old } = makeClient(t.deps);
    await old.auth.login({ email: v.email, password: v.password });

    expect(await code(a.volunteers.passwordResetLink({ id: admin.id }))).toBe("CONFLICT"); // not on yourself
    const { token, expiresAt } = await a.volunteers.passwordResetLink({ id: v.id });
    expect(new Date(expiresAt).getTime() - t.deps.now().getTime()).toBe(24 * 3600_000);

    const { client: anon } = makeClient(t.deps);
    expect(await anon.auth.resetPassword({ token, password: "a-brand-new-pass" })).toEqual({ ok: true });
    expect(await t.deps.db.select().from(sessions).where(eq(sessions.volunteerId, v.id))).toHaveLength(0);
    expect(await code(old.auth.me())).toBe("UNAUTHORIZED");
    expect(await code(anon.auth.login({ email: v.email, password: v.password }))).toBe("UNAUTHORIZED");
    expect((await anon.auth.login({ email: v.email, password: "a-brand-new-pass" })).id).toBe(v.id);

    expect(await code(makeClient(t.deps).client.auth.resetPassword({ token, password: "yet-another-pass" }))).toBe("NOT_FOUND");
  });

  it("expires after 24 h, and a new link cancels the previous one", async () => {
    t = await makeE2E();
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client: a } = makeClient(t.deps);
    await a.auth.login({ email: admin.email, password: admin.password });
    const v = await createVolunteer(t.deps);
    const first = await a.volunteers.passwordResetLink({ id: v.id });
    const second = await a.volunteers.passwordResetLink({ id: v.id });
    const { client: anon } = makeClient(t.deps);
    expect(await code(anon.auth.resetPassword({ token: first.token, password: "a-brand-new-pass" }))).toBe("NOT_FOUND");
    t.clock.set(new Date(t.deps.now().getTime() + 25 * 3600_000).toISOString());
    expect(await code(anon.auth.resetPassword({ token: second.token, password: "a-brand-new-pass" }))).toBe("NOT_FOUND");
  });

  it("a plain volunteer cannot create one", async () => {
    t = await makeE2E();
    const other = await createVolunteer(t.deps);
    expect(await code(t.client.volunteers.passwordResetLink({ id: other.id }))).not.toBe("ok");
  });
});

describe("first-day welcome", () => {
  it("shows on a new account until it is closed", async () => {
    t = await makeE2E();
    const v = await createVolunteer(t.deps);
    const { client } = makeClient(t.deps);
    expect((await client.auth.login({ email: v.email, password: v.password })).showWelcome).toBe(true);
    expect((await client.auth.finishWelcome()).showWelcome).toBe(false);
    expect((await client.auth.me()).showWelcome).toBe(false);
  });
});

describe("quick replies", () => {
  it("everyone who replies reads them; only replies.manage edits them", async () => {
    t = await makeE2E();
    const starters = await t.client.quickReplies.list();
    expect(starters.length).toBeGreaterThanOrEqual(5);
    expect(starters.map((r) => r.title)).toContain("Urgence");

    expect(await code(t.client.quickReplies.create({ title: "x", text: "y" }))).toBe("FORBIDDEN");
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const { client: a } = makeClient(t.deps);
    await a.auth.login({ email: admin.email, password: admin.password });
    const r = await a.quickReplies.create({ title: "Horaires", text: "La permanence est ouverte le mardi de 14 h à 17 h." });
    expect((await t.client.quickReplies.list()).at(-1)).toEqual(r);
    expect((await a.quickReplies.update({ id: r.id, title: "Horaires", text: "Mardi 14 h - 17 h." })).text).toBe("Mardi 14 h - 17 h.");
    await a.quickReplies.remove({ id: r.id });
    expect((await t.client.quickReplies.list()).some((x) => x.id === r.id)).toBe(false);
  });
});

describe("nickname", () => {
  it("is shown in conversations and people, stored encrypted, and erased with the person's data", async () => {
    t = await makeE2E();
    const { p, bid } = await person(t, "33621000001");
    await p.say("4");
    await p.say("où trouver un repas ce soir ?");
    expect(await t.client.beneficiaries.setNickname({ id: bid, nickname: "  Amina " })).toEqual({ nickname: "Amina" });
    expect((await t.client.conversations.get({ beneficiaryId: bid })).nickname).toBe("Amina");
    expect((await t.client.conversations.list({ filter: "all", limit: 20 })).items.find((c) => c.beneficiaryId === bid)?.nickname).toBe("Amina");
    expect((await t.client.beneficiaries.get({ id: bid })).nickname).toBe("Amina");
    const [raw] = await t.deps.db.select({ n: beneficiaries.nicknameEnc }).from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(raw!.n!.toString("utf8")).not.toContain("Amina");

    expect(await t.client.beneficiaries.setNickname({ id: bid, nickname: "" })).toEqual({ nickname: null });
    expect((await t.client.beneficiaries.get({ id: bid })).nickname).toBeNull();

    await t.client.beneficiaries.setNickname({ id: bid, nickname: "Amina" });
    await t.services.beneficiaries.archiveAll(bid);
    const [after] = await t.deps.db.select({ n: beneficiaries.nicknameEnc }).from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(after!.n).toBeNull();
  });
});

describe("waiting alert", () => {
  it("posts only counts, during the day, at most every WAITING_ALERT_HOURS", async () => {
    t = await makeE2E({ config: { CHAT_MODE: "auto", WAITING_ALERT_HOURS: "2" } });
    const { p, bid } = await person(t, "33621000002");
    await p.say("4");
    await p.say("j'ai besoin d'un avocat pour mon recours");
    expect((await t.client.conversations.get({ beneficiaryId: bid })).status).toBe("needs_human");
    // The person wrote at 09:00 Paris and nobody answered.
    await t.deps.db.update(messages).set({ createdAt: new Date("2026-11-06T08:00:00Z") }).where(eq(messages.beneficiaryId, bid));

    expect(await dispatchWaitingAlert(t.deps, new Date("2026-11-06T09:30:00Z"))).toMatchObject({ people: 0, sent: false }); // 1 h 30: not yet
    expect((await dispatchWaitingAlert(t.deps, new Date("2026-11-06T22:30:00Z"))).sent).toBe(false); // 23:30 Paris: nobody is paged at night
    const day = await dispatchWaitingAlert(t.deps, new Date("2026-11-06T12:00:00Z"));
    expect(day).toMatchObject({ people: 1, sent: true });
    const text = recentAlerts.at(-1)!.text;
    expect(recentAlerts.at(-1)!.key).toBe("waiting");
    expect(text).toContain("1 personne attend une réponse depuis plus de 2 h");
    expect(text).not.toContain("33621000002");
    expect(text).not.toContain("avocat");
    expect((await dispatchWaitingAlert(t.deps, new Date("2026-11-06T13:00:00Z"))).sent).toBe(false); // repeated at most every 2 h
    expect((await dispatchWaitingAlert(t.deps, new Date("2026-11-06T14:30:00Z"))).sent).toBe(true);
  });

  it("is off with WAITING_ALERT_HOURS=0", async () => {
    t = await makeE2E({ config: { WAITING_ALERT_HOURS: "0" } });
    expect(await dispatchWaitingAlert(t.deps, new Date("2026-11-06T12:00:00Z"))).toEqual({ people: 0, letters: 0, sent: false });
  });
});
