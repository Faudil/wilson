import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { contract } from "@wilson/contracts";
import { accessLog, sessions, volunteerPermissions, volunteers } from "../src/db/schema.js";
import { seed } from "../src/db/seed.js";
import { router } from "../src/rpc/router.js";
import { createHttpServer } from "../src/server.js";
import type { WaDeps } from "../src/whatsapp/context.js";
import { createVolunteer, makeClient, makeTestDeps, PNG_BYTES, type TestCtx } from "./helpers.js";

let t: TestCtx;
beforeAll(async () => {
  t = await makeTestDeps({ now: "2026-11-06T12:00:00Z" });
});
afterAll(async () => {
  await t.close();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "error",
  );

describe("auth", () => {
  it("login / me / logout; sessions store only a hash", async () => {
    const v = await createVolunteer(t.deps, { email: "a@example.org", name: "Alice" });
    const { client, jar } = makeClient(t.deps);
    expect(await code(client.auth.me())).toBe("UNAUTHORIZED");
    expect(await code(client.auth.login({ email: "a@example.org", password: "wrong-password" }))).toBe("UNAUTHORIZED");
    expect(await code(client.auth.login({ email: "nobody@example.org", password: "whatever-pass" }))).toBe("UNAUTHORIZED");

    const me = await client.auth.login({ email: "a@example.org", password: v.password });
    expect(me).toMatchObject({ id: v.id, name: "Alice", role: "volunteer", uiLanguage: "fr" });
    expect(me.permissions).toContain("letters.review");
    expect(me.permissions).not.toContain("volunteers.manage");
    expect(jar.token).toBeTruthy();
    const rows = await t.deps.db.select().from(sessions).where(eq(sessions.volunteerId, v.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idHash).toBe(createHash("sha256").update(jar.token!).digest("hex"));
    expect(rows[0]!.idHash).not.toBe(jar.token);
    expect(rows[0]!.expiresAt.toISOString()).toBe("2026-11-07T00:00:00.000Z");

    expect((await client.auth.me()).email).toBe("a@example.org");
    expect((await client.auth.setUiLanguage({ language: "ar" })).uiLanguage).toBe("ar");
    await client.auth.logout();
    expect(jar.token).toBeNull();
    expect(await code(client.auth.me())).toBe("UNAUTHORIZED");
    expect(await t.deps.db.select().from(sessions).where(eq(sessions.volunteerId, v.id))).toHaveLength(0);
  });

  it("sessions expire; disabled volunteers lose access", async () => {
    const v = await createVolunteer(t.deps);
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: v.email, password: v.password });
    t.clock.set("2026-11-07T00:00:01Z");
    expect(await code(client.auth.me())).toBe("UNAUTHORIZED");
    t.clock.set("2026-11-06T12:00:00Z");
    await client.auth.login({ email: v.email, password: v.password });
    await t.deps.db.update(volunteers).set({ disabledAt: new Date() }).where(eq(volunteers.id, v.id));
    expect(await code(client.auth.me())).toBe("UNAUTHORIZED");
    expect(await code(client.auth.login({ email: v.email, password: v.password }))).toBe("UNAUTHORIZED");
  });

  it("effective permissions = role bundle ± volunteer_permissions", async () => {
    const admin = await createVolunteer(t.deps, { role: "admin" });
    const a = makeClient(t.deps);
    expect((await a.client.auth.login({ email: admin.email, password: admin.password })).permissions).toEqual(
      expect.arrayContaining(["volunteers.manage", "audit.view", "documents.view_file"]),
    );

    const v = await createVolunteer(t.deps);
    await t.deps.db.insert(volunteerPermissions).values([
      { volunteerId: v.id, permission: "documents.view_file", granted: false },
      { volunteerId: v.id, permission: "audit.view", granted: true },
    ]);
    const b = makeClient(t.deps);
    const perms = (await b.client.auth.login({ email: v.email, password: v.password })).permissions;
    expect(perms).not.toContain("documents.view_file");
    expect(perms).toContain("audit.view");
    expect(perms).toContain("documents.view_metadata");
  });

  it("seed is idempotent and creates the admin and the demo volunteer", async () => {
    const env = { SEED_ADMIN_EMAIL: "Boss@Example.org", SEED_ADMIN_PASSWORD: "seed-password-1", NODE_ENV: "development" } as NodeJS.ProcessEnv;
    const first = await seed(t.deps.db, env);
    expect(first.created).toHaveLength(2);
    expect((await seed(t.deps.db, env)).created).toHaveLength(0);
    const { client } = makeClient(t.deps);
    expect((await client.auth.login({ email: "boss@example.org", password: "seed-password-1" })).role).toBe("admin");
    const [demo] = await t.deps.db.select().from(volunteers).where(eq(volunteers.name, "Bénévole Démo"));
    expect(demo!.role).toBe("volunteer");
    const prod = await seed(t.deps.db, { ...env, NODE_ENV: "production", SEED_ADMIN_EMAIL: "other@example.org" });
    expect(prod.created).toEqual(["other@example.org"]);
  });
});

describe("rpc: documents & beneficiaries", () => {
  it("requires a session, enforces permissions, logs file access", async () => {
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId("33611112221");
    const { documentId } = await t.services.documents.createFromUpload({ beneficiaryId: beneficiary.id, bytes: PNG_BYTES, mimeType: "image/png" });
    await t.services.documents.applyDetection(documentId, { type: "recepisse", expiresAt: "2026-12-01", confidence: 1, quote: null, promptVersion: "t" });
    await t.services.documents.confirm(documentId);

    const { client } = makeClient(t.deps);
    expect(await code(client.documents.deadlines({ withinDays: 60 }))).toBe("UNAUTHORIZED");
    expect(await code(client.beneficiaries.list({ limit: 20 }))).toBe("UNAUTHORIZED");

    const v = await createVolunteer(t.deps);
    await client.auth.login({ email: v.email, password: v.password });

    const rows = await client.documents.deadlines({ withinDays: 60 });
    expect(rows).toEqual([
      { documentId, beneficiaryId: beneficiary.id, beneficiaryLabel: "•• •• •• •• 21", type: "recepisse", expiresAt: "2026-12-01", daysLeft: 25 },
    ]);
    expect(await client.documents.deadlines({ withinDays: 10 })).toHaveLength(0);

    const file = await client.documents.file({ id: documentId });
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
    expect(file.type).toBe("image/png");
    const log = await t.deps.db.select().from(accessLog).where(eq(accessLog.targetId, documentId));
    expect(log.map((l) => [l.action, l.volunteerId])).toEqual([["documents.file", v.id]]);

    // revoke view_file → FORBIDDEN, but metadata still allowed
    await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: "documents.view_file", granted: false });
    expect(await code(client.documents.file({ id: documentId }))).toBe("FORBIDDEN");
    expect(await code(client.documents.deadlines({ withinDays: 60 }))).toBe("ok");
    await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: "documents.edit", granted: false });
    expect(await code(client.documents.archive({ id: documentId }))).toBe("FORBIDDEN");
    await t.deps.db.delete(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, v.id));

    // update reschedules reminders; archive hides
    const updated = await client.documents.update({ id: documentId, expiresAt: "2027-02-01", label: "Récépissé n°2" });
    expect(updated).toMatchObject({ expiresAt: "2027-02-01", label: "Récépissé n°2", expirySource: "entered_by_volunteer" });
    expect(updated.reminders.map((r) => r.kind)).toEqual(["d30", "d7"]);
    expect(await code(client.documents.update({ id: crypto.randomUUID(), label: "x" }))).toBe("NOT_FOUND");

    const detail = await client.beneficiaries.get({ id: beneficiary.id });
    expect(detail).toMatchObject({ id: beneficiary.id, label: "•• •• •• •• 21", documentCount: 1, nextExpiry: "2027-02-01" });
    expect(detail.documents).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain("33611112221");

    const list = await client.beneficiaries.list({ limit: 20, search: "21" });
    expect(list.items.map((i) => i.id)).toContain(beneficiary.id);
    expect((await client.beneficiaries.list({ limit: 20, search: "99" })).items).toHaveLength(0);
    expect((await client.beneficiaries.setLanguage({ id: beneficiary.id, language: "ar" })).language).toBe("ar");

    const archived = await client.documents.archive({ id: documentId });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.reminders).toHaveLength(0);
  });

  it("paginates beneficiaries", async () => {
    for (let i = 0; i < 3; i++) await t.services.beneficiaries.findOrCreateByWaId(`3360000010${i}`);
    const v = await createVolunteer(t.deps);
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: v.email, password: v.password });
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.beneficiaries.list({ limit: 2, cursor });
      for (const i of page.items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it("system.health is public", async () => {
    const { client } = makeClient(t.deps);
    expect(await client.system.health()).toEqual({ ok: true, mode: "sandbox", llm: "fake", chat: "review" });
  });
});

describe("contract coverage", () => {
  const isProcedure = (x: unknown) => typeof x === "object" && x !== null && "~orpc" in x && "handler" in ((x as Record<string, any>)["~orpc"] ?? {});
  const leaves = (node: unknown, path: string[] = []): string[] => {
    if (typeof node === "object" && node !== null && "~orpc" in node && !("handler" in ((node as any)["~orpc"] ?? {}))) return [path.join(".")];
    if (typeof node === "object" && node !== null && !("~orpc" in node)) return Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]));
    return [path.join(".")];
  };
  const get = (root: any, path: string) => path.split(".").reduce((n, k) => n?.[k], root);

  it("every contract procedure is implemented by the router", () => {
    const expected = leaves(contract);
    expect(expected.length).toBeGreaterThanOrEqual(21);
    const missing = expected.filter((p) => !isProcedure(get(router, p)));
    expect(missing).toEqual([]);
  });

  it("the router has no procedure outside the contract", () => {
    const implemented = leaves(router);
    const known = new Set(leaves(contract));
    expect(implemented.filter((p) => !known.has(p))).toEqual([]);
  });
});

describe("http server", () => {
  it("serves /health, sets a hardened session cookie, applies CORS with credentials", async () => {
    const deps = { ...t.deps, beneficiaries: t.services.beneficiaries, documents: t.services.documents, letters: {} } as unknown as WaDeps;
    const server = createHttpServer(deps);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/nope`)).status).toBe(404);

      const v = await createVolunteer(t.deps);
      const rpc = (path: string, body: unknown, cookie?: string) =>
        fetch(`${base}/rpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(cookie ? { cookie } : {}) },
          body: JSON.stringify({ json: body }),
        });
      const res = await rpc("auth/login", { email: v.email, password: v.password });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toMatch(/^wilson_session=[^;]+/);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).not.toContain("Secure"); // test env, not production
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");

      const cookie = setCookie.split(";")[0]!;
      const me = await rpc("auth/me", undefined, cookie);
      expect(me.status).toBe(200);
      expect(((await me.json()) as { json: { email: string } }).json.email).toBe(v.email);
      expect((await rpc("auth/me", undefined)).status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
