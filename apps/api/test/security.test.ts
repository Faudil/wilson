import { afterEach, describe, expect, it } from "bun:test";
import type { IncomingMessage } from "node:http";
import { createRouterClient } from "@orpc/server";
import type { ContractRouterClient } from "@orpc/contract";
import { eq } from "drizzle-orm";
import type { contract } from "@wilson/contracts";
import { alert, recentAlerts } from "../src/alerts.js";
import { totpCode, stepAt, verifyTotp, base32Decode, base32Encode } from "../src/auth/totp.js";
import { accessLog, volunteers } from "../src/db/schema.js";
import { setMailer } from "../src/mail.js";
import type { RpcContext } from "../src/rpc/base.js";
import { createContext } from "../src/rpc/context.js";
import { router } from "../src/rpc/router.js";
import { clientIp } from "../src/server.js";
import type { Deps } from "../src/deps.js";
import { createVolunteer } from "./helpers.js";
import { makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** A client calling from one IP address, with its own cookie jar. */
function clientFrom(deps: Deps, ip: string | null = "203.0.113.7") {
  const jar: { token: string | null } = { token: null };
  return createRouterClient(router, {
    context: (): Promise<RpcContext> => createContext(deps, jar.token, (tk) => void (jar.token = tk), ip),
  }) as unknown as ContractRouterClient<typeof contract>;
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const signupInput = (email: string, extra: object = {}) => ({
  name: "Nouvelle Personne", email, password: "bien-long-mot-de-passe", uiLanguage: "fr" as const, acceptsConfidentiality: true as const, ...extra,
});
const later = (e: E2E, ms: number) => e.clock.set(new Date(e.clock.current.getTime() + ms).toISOString());

describe("login protection", () => {
  it("locks an e-mail after repeated failures, from any IP, with an alert; the right password works again after the lock", async () => {
    t = await makeE2E({ config: { LOGIN_MAX_FAILURES: "3", LOGIN_LOCK_MINUTES: "15" } });
    const v = await createVolunteer(t.deps);
    const a = clientFrom(t.deps, "198.51.100.1");
    for (let i = 0; i < 3; i++) expect(await code(a.auth.login({ email: v.email, password: "wrong-password" }))).toBe("UNAUTHORIZED");
    const b = clientFrom(t.deps, "198.51.100.2");
    expect(await code(b.auth.login({ email: v.email, password: v.password }))).toBe("TOO_MANY_REQUESTS");
    expect(recentAlerts.at(-1)?.key).toBe("auth.lock");
    later(t, 16 * 60_000);
    expect(await b.auth.login({ email: v.email, password: v.password })).toMatchObject({ id: v.id });
  });

  it("blocks an IP that tries many accounts", async () => {
    t = await makeE2E({ config: { LOGIN_MAX_FAILURES_PER_IP: "4" } });
    const v = await createVolunteer(t.deps);
    const a = clientFrom(t.deps, "198.51.100.9");
    for (let i = 0; i < 4; i++) await code(a.auth.login({ email: `nobody${i}@example.org`, password: "whatever-pass" }));
    expect(await code(a.auth.login({ email: v.email, password: v.password }))).toBe("TOO_MANY_REQUESTS");
    expect(await code(clientFrom(t.deps, "198.51.100.10").auth.login({ email: v.email, password: v.password }))).toBe("ok");
  });
});

describe("two-factor authentication", () => {
  it("admin rights are withheld until an authenticator app is enrolled; then login needs a fresh code", async () => {
    t = await makeE2E({ config: { ADMIN_2FA: "required" } });
    const admin = await createVolunteer(t.deps, { role: "admin", name: "Admin" });
    const c = clientFrom(t.deps);
    const me = await c.auth.login({ email: admin.email, password: admin.password });
    expect(me.twoFactorMissing).toBe(true);
    expect(me.permissions).not.toContain("volunteers.manage");
    expect(me.permissions).toContain("letters.review");
    expect(await code(c.volunteers.list({}))).toBe("FORBIDDEN");

    const { secret, uri } = await c.auth.twoFactorSetup();
    expect(uri).toStartWith("otpauth://totp/");
    expect(await code(c.auth.twoFactorEnable({ code: "000000" }))).toBe("CONFLICT");
    const now = t.clock.now();
    const enabled = await c.auth.twoFactorEnable({ code: totpCode(secret, stepAt(now)) });
    expect(enabled).toMatchObject({ twoFactorEnabled: true, twoFactorMissing: false });
    expect(enabled.permissions).toContain("volunteers.manage");
    // The secret is stored encrypted.
    const [row] = await t.deps.db.select().from(volunteers).where(eq(volunteers.id, admin.id));
    expect(row!.totpSecretEnc!.toString("utf8")).not.toContain(secret);

    const d = clientFrom(t.deps);
    const e1 = await d.auth.login({ email: admin.email, password: admin.password }).catch((e) => e);
    expect([e1.code, e1.message]).toEqual(["TWO_FACTOR_REQUIRED", "code_needed"]);
    // The code used to enrol cannot be replayed.
    const e2 = await d.auth.login({ email: admin.email, password: admin.password, totp: totpCode(secret, stepAt(now)) }).catch((e) => e);
    expect([e2.code, e2.message]).toEqual(["TWO_FACTOR_REQUIRED", "invalid_code"]);
    later(t, 30_000);
    const fresh = totpCode(secret, stepAt(t.clock.now()));
    expect(await d.auth.login({ email: admin.email, password: admin.password, totp: fresh })).toMatchObject({ twoFactorEnabled: true });
    expect(await d.volunteers.list({})).toBeArray();

    // Another admin resets it (lost phone): sessions are revoked and the code is no longer asked.
    const other = await createVolunteer(t.deps, { role: "admin" });
    await t.deps.db.update(volunteers).set({ totpEnabledAt: new Date() }).where(eq(volunteers.id, other.id));
    const o = clientFrom(t.deps);
    await o.auth.login({ email: other.email, password: other.password }).catch(() => null);
    // `other` has no real secret: give it one through the API instead.
    await t.deps.db.update(volunteers).set({ totpEnabledAt: null }).where(eq(volunteers.id, other.id));
    await o.auth.login({ email: other.email, password: other.password });
    const s2 = await o.auth.twoFactorSetup();
    await o.auth.twoFactorEnable({ code: totpCode(s2.secret, stepAt(t.clock.now())) });
    expect(await d.volunteers.resetTwoFactor({ id: other.id })).toMatchObject({ twoFactorEnabled: false });
    expect(await code(o.auth.me())).toBe("UNAUTHORIZED");
    expect(recentAlerts.at(-1)?.key).toBe(`volunteers.reset_2fa:${other.id}`);

    // Disabling needs a valid code.
    later(t, 30_000);
    expect(await code(d.auth.twoFactorDisable({ code: "123456" }))).toBe("CONFLICT");
    expect(await d.auth.twoFactorDisable({ code: totpCode(secret, stepAt(t.clock.now())) })).toMatchObject({ twoFactorEnabled: false, twoFactorMissing: true });
  });

  it("TOTP matches the RFC 6238 test vector and accepts ±1 step", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(totpCode(secret, Math.floor(59 / 30))).toBe("287082"); // RFC 6238, T=59 s, last 6 digits of 94287082
    const at = new Date(1_111_111_109_000);
    expect(totpCode(secret, stepAt(at))).toBe("081804");
    expect(verifyTotp(secret, totpCode(secret, stepAt(at) - 1), at, null)).toBe(stepAt(at) - 1);
    expect(verifyTotp(secret, totpCode(secret, stepAt(at) - 2), at, null)).toBeNull();
  });
});

describe("volunteer signup hardening", () => {
  it("ignores the honeypot, limits requests per IP and per day", async () => {
    t = await makeE2E({ config: { SIGNUP_PER_IP_PER_HOUR: "2", SIGNUP_PER_DAY: "3" } });
    const pending = async () => (await t!.deps.db.select().from(volunteers).where(eq(volunteers.pendingApproval, true))).length;
    const a = clientFrom(t.deps, "192.0.2.1");
    expect(await a.auth.signup(signupInput("bot@example.org", { website: "http://spam" }))).toEqual({ ok: true });
    expect(await pending()).toBe(0);
    await a.auth.signup(signupInput("p1@example.org"));
    expect(await code(a.auth.signup(signupInput("p2@example.org")))).toBe("TOO_MANY_REQUESTS");
    const b = clientFrom(t.deps, "192.0.2.2");
    await b.auth.signup(signupInput("p3@example.org"));
    expect(await code(clientFrom(t.deps, "192.0.2.3").auth.signup(signupInput("p4@example.org")))).toBe("TOO_MANY_REQUESTS");
    expect(recentAlerts.at(-1)?.key).toBe("signup.flood");
    expect(await pending()).toBe(2);
  });

  it("with e-mail set up, a signup must click the link before an admin can approve it", async () => {
    t = await makeE2E({ config: { SMTP_URL: "smtp://localhost:2525", PUBLIC_BACKOFFICE_ORIGIN: "https://courrier.example.org" } });
    const sent: { to: string; text: string }[] = [];
    setMailer(t.deps, { send: async (to, _s, text) => void sent.push({ to, text }) });
    const anon = clientFrom(t.deps);
    await anon.auth.signup(signupInput("Verif@Example.org"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("verif@example.org");
    const token = sent[0]!.text.match(/#\/verify\/([\w-]+)/)![1]!;
    expect(sent[0]!.text).toContain("https://courrier.example.org/#/verify/");

    const admin = await createVolunteer(t.deps, { role: "admin" });
    const c = clientFrom(t.deps);
    await c.auth.login({ email: admin.email, password: admin.password });
    const [acc] = await c.volunteers.list({ status: "pending" });
    expect(acc).toMatchObject({ email: "verif@example.org", emailVerified: false });
    const err = await c.volunteers.approve({ id: acc!.id, role: "responder" }).catch((e) => e);
    expect(err.data).toEqual({ reason: "email_unverified" });

    expect(await anon.auth.verifyEmail({ token: "x".repeat(43) })).toEqual({ ok: true }); // unknown token: same answer
    await anon.auth.verifyEmail({ token });
    expect((await c.volunteers.list({ status: "pending" }))[0]).toMatchObject({ emailVerified: true });
    expect(await c.volunteers.approve({ id: acc!.id, role: "responder" })).toMatchObject({ status: "active" });
  });

  it("drops unverified requests whose link expired", async () => {
    t = await makeE2E({ config: { SMTP_URL: "smtp://localhost:2525" } });
    setMailer(t.deps, { send: async () => {} });
    await clientFrom(t.deps, "192.0.2.10").auth.signup(signupInput("old@example.org"));
    later(t, 49 * 3600_000);
    await clientFrom(t.deps, "192.0.2.11").auth.signup(signupInput("new@example.org"));
    const emails = (await t.deps.db.select().from(volunteers).where(eq(volunteers.pendingApproval, true))).map((v) => v.email);
    expect(emails).toEqual(["new@example.org"]);
  });
});

describe("unusual access", () => {
  async function setup(action: "alert" | "suspend") {
    t = await makeE2E({ config: { AUDIT_READS_PER_HOUR: "5", AUDIT_BULK_READ_ACTION: action } });
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await t.services.beneficiaries.findOrCreateByWaId(`3361300000${i}`)).beneficiary.id);
    const v = await createVolunteer(t.deps, { name: "Curious" });
    const c = clientFrom(t.deps);
    await c.auth.login({ email: v.email, password: v.password });
    return { ids, v, c };
  }

  it("polling one person does not count; opening many different people raises one alert and an audit row", async () => {
    const { ids, v, c } = await setup("alert");
    for (let i = 0; i < 10; i++) await c.beneficiaries.get({ id: ids[0]! });
    expect(recentAlerts.filter((a) => a.key === `audit.bulk:${v.id}`)).toHaveLength(0);
    for (const id of ids) await c.beneficiaries.get({ id });
    expect(recentAlerts.filter((a) => a.key === `audit.bulk:${v.id}`)).toHaveLength(1);
    expect(recentAlerts.at(-1)!.text).toContain("Curious");
    const rows = await t!.deps.db.select().from(accessLog).where(eq(accessLog.volunteerId, v.id));
    expect(rows.map((r) => r.action)).toContain("audit.bulk_read:6");
    expect(await code(c.auth.me())).toBe("ok");
  });

  it("AUDIT_BULK_READ_ACTION=suspend disables the account at once", async () => {
    const { ids, v, c } = await setup("suspend");
    for (const id of ids) await code(c.beneficiaries.get({ id }));
    expect(await code(c.auth.me())).toBe("UNAUTHORIZED");
    const [row] = await t!.deps.db.select().from(volunteers).where(eq(volunteers.id, v.id));
    expect(row!.disabledAt).not.toBeNull();
  });
});

describe("helpers", () => {
  it("reads the visitor IP behind the configured number of proxies, ignoring forged entries", () => {
    const req = (xff?: string) => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: "10.0.0.5" } }) as unknown as IncomingMessage;
    // forged, real visitor (added by nginx), nginx (added by the back-office server)
    expect(clientIp(req("1.1.1.1, 203.0.113.9, 172.18.0.1"), 1)).toBe("203.0.113.9");
    expect(clientIp(req("203.0.113.9, 172.18.0.1"), 1)).toBe("203.0.113.9");
    expect(clientIp(req("172.18.0.1"), 0)).toBe("172.18.0.1");
    expect(clientIp(req(), 1)).toBe("10.0.0.5");
  });

  it("posts alerts to the webhook once per cooldown", async () => {
    const calls: string[] = [];
    const deps = { config: { ALERT_WEBHOOK_URL: "https://chat.example.org/hook" }, now: () => new Date("2026-11-07T10:00:00Z"), fetch: async (_u: string, i: RequestInit) => (calls.push(String(i.body)), new Response()) };
    await alert(deps, "k", "first");
    await alert(deps, "k", "second");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!)).toEqual({ text: "Wilson: first", content: "Wilson: first" });
  });
});
