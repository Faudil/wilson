import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  BeneficiaryDetailSchema, contract, DeadlineRowSchema, LetterDetailSchema, type Permission,
} from "@wilson/contracts";
import { volunteerPermissions } from "../src/db/schema.js";
import { registerWaDeps, type WaDeps } from "../src/whatsapp/context.js";
import { createVolunteer, makeClient, makeTestDeps } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";

// "every leaf of the contract is implemented by the router" already lives in core.rpc.test.ts ("contract coverage").

const leaves = (node: unknown, path: string[] = []): string[] =>
  typeof node === "object" && node !== null && !("~orpc" in node)
    ? Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]))
    : [path.join(".")];
const call = (client: unknown, path: string, input?: unknown): Promise<unknown> =>
  (path.split(".").reduce((n: any, k) => n[k], client) as (i?: unknown) => Promise<unknown>)(input);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

const id = randomUUID();
const phone = "33614000001";
/** A schema-valid input for each procedure, so rejection comes from the auth layer and not from input validation. */
const INPUTS: Record<string, unknown> = {
  "auth.login": { email: "a@example.org", password: "whatever-pass" },
  "auth.signup": { name: "Coverage", email: "coverage-signup@example.org", password: "long-enough-pass", uiLanguage: "fr", acceptsConfidentiality: true },
  "auth.logout": undefined,
  "auth.me": undefined,
  "auth.setUiLanguage": { language: "fr" },
  "letters.list": { limit: 5 },
  "letters.get": { id },
  "letters.photo": { id },
  "letters.edit": { id },
  "letters.approve": { id },
  "letters.reject": { id },
  "beneficiaries.list": { limit: 5 },
  "beneficiaries.get": { id },
  "beneficiaries.setLanguage": { id, language: "fr" },
  "documents.deadlines": { withinDays: 30 },
  "documents.file": { id },
  "documents.update": { id, label: "x" },
  "documents.archive": { id },
  "sandbox.send": { phone, text: "x" },
  "sandbox.thread": { phone },
  "sandbox.runReminders": { date: "2026-11-06" },
  "sandbox.reset": { phone },
  "knowledge.sources": undefined,
  "knowledge.search": { query: "titre de séjour", limit: 3 },
  "knowledge.sync": { sourceId: "association" },
  "conversations.list": { limit: 5, filter: "all" },
  "conversations.get": { beneficiaryId: id },
  "conversations.approveDraft": { messageId: id },
  "conversations.rejectDraft": { messageId: id },
  "conversations.reply": { beneficiaryId: id, textFr: "Bonjour" },
  "conversations.takeOver": { beneficiaryId: id },
  "conversations.resolve": { beneficiaryId: id },
  "volunteers.list": {},
  "volunteers.approve": { id },
  "volunteers.reject": { id },
  "volunteers.setRole": { id, role: "volunteer" },
  "volunteers.setDisabled": { id, disabled: true },
  "usage.summary": undefined,
  "usage.setBudget": { monthlyLimitUsd: 50, hardStop: false },
  "usage.listKeys": undefined,
  "usage.addKey": { label: "Coverage", apiKey: "sk-ant-api03-coverageXXXXXXXXXXXXXXXX", monthlyLimitUsd: 10 },
  "usage.updateKey": { id, label: "x" },
  "usage.removeKey": { id },
  "system.health": undefined,
};
/** The permission each procedure needs (the router's `requirePermission`). null = any logged-in volunteer. */
const REQUIRES: Record<string, Permission | null> = {
  "auth.me": null, "auth.setUiLanguage": null,
  "letters.list": "letters.review", "letters.get": "letters.review", "letters.edit": "letters.review",
  "letters.approve": "letters.review", "letters.reject": "letters.review", "letters.photo": "letters.view_photo",
  "beneficiaries.list": "beneficiaries.view", "beneficiaries.get": "beneficiaries.view", "beneficiaries.setLanguage": "beneficiaries.edit",
  "documents.deadlines": "documents.view_metadata", "documents.file": "documents.view_file",
  "documents.update": "documents.edit", "documents.archive": "documents.edit",
  "sandbox.send": "sandbox.use", "sandbox.thread": "sandbox.use", "sandbox.runReminders": "sandbox.use", "sandbox.reset": "sandbox.use",
  "knowledge.sources": "knowledge.view", "knowledge.search": "knowledge.view", "knowledge.sync": "knowledge.manage",
  "conversations.list": "conversations.view", "conversations.get": "conversations.view",
  "conversations.approveDraft": "conversations.reply", "conversations.rejectDraft": "conversations.reply",
  "conversations.reply": "conversations.reply", "conversations.resolve": "conversations.reply", "conversations.takeOver": "conversations.reply",
  "volunteers.list": "volunteers.manage", "volunteers.approve": "volunteers.manage", "volunteers.reject": "volunteers.manage",
  "volunteers.setRole": "volunteers.manage", "volunteers.setDisabled": "volunteers.manage",
  "usage.summary": "usage.manage", "usage.setBudget": "usage.manage", "usage.listKeys": "usage.manage",
  "usage.addKey": "usage.manage", "usage.updateKey": "usage.manage", "usage.removeKey": "usage.manage",
};
const PUBLIC = new Set(["auth.login", "auth.signup", "system.health"]);
/** auth.logout is deliberately idempotent for anonymous callers (clears the cookie, returns void). */
const ANON_OK = new Set([...PUBLIC, "auth.logout"]);
const ALL = leaves(contract);

let t: E2E;
beforeAll(async () => {
  t = await makeE2E();
});
afterAll(() => t.close());

describe("contract coverage", () => {
  it("this file knows every procedure of the contract", () => {
    expect(Object.keys(INPUTS).sort()).toEqual([...ALL].sort());
  });

  it("every procedure except auth.login / auth.signup / system.health / (idempotent) auth.logout rejects an anonymous caller with UNAUTHORIZED", async () => {
    const { client } = makeClient(t.deps);
    for (const p of ALL.filter((p) => !ANON_OK.has(p))) {
      expect([p, await code(call(client, p, INPUTS[p]))]).toEqual([p, "UNAUTHORIZED"]);
    }
    expect(await code(call(client, "auth.logout"))).toBe("ok");
    expect(await call(client, "system.health")).toMatchObject({ ok: true });
  });

  it("a volunteer whose permission was revoked gets FORBIDDEN on exactly the procedures needing it", async () => {
    const needed = [...new Set(Object.values(REQUIRES).filter((p): p is Permission => p !== null))];
    for (const perm of needed) {
      const v = await createVolunteer(t.deps);
      await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: perm, granted: false });
      // knowledge.manage / volunteers.manage are admin-only by role: grant them per-volunteer so every other procedure starts allowed.
      for (const adminOnly of ["knowledge.manage", "volunteers.manage", "usage.manage"] as const) {
        if (perm !== adminOnly) await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: adminOnly, granted: true });
      }
      const { client } = makeClient(t.deps);
      await client.auth.login({ email: v.email, password: v.password });
      for (const [proc, req] of Object.entries(REQUIRES)) {
        const c = await code(call(client, proc, INPUTS[proc]));
        if (req === perm) expect([perm, proc, c]).toEqual([perm, proc, "FORBIDDEN"]);
        else expect([perm, proc, c]).not.toEqual([perm, proc, "FORBIDDEN"]);
      }
    }
  });

  it("outputs of letters.get / beneficiaries.get / documents.deadlines parse with the contract schemas", async () => {
    const p = t.phone(phone);
    await p.say("مرحبا، أحتاج مساعدة");
    await p.say("1");
    await p.send(sampleFile("letters", "01-prefecture-convocation-titre-sejour.png"));
    await p.say("2");
    await p.send(sampleFile("documents", "d1-recepisse.png"));
    await p.say("1");
    const bid = await beneficiaryIdOf(t, phone);

    const page = await t.client.letters.list({ limit: 10 });
    const item = page.items.find((l) => l.beneficiaryId === bid)!;
    LetterDetailSchema.parse(await t.client.letters.get({ id: item.id }));
    await t.client.letters.approve({ id: item.id });
    await t.queue.drain();
    LetterDetailSchema.parse(await t.client.letters.get({ id: item.id }));
    BeneficiaryDetailSchema.parse(await t.client.beneficiaries.get({ id: bid }));
    const rows = await t.client.documents.deadlines({ withinDays: 365 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) DeadlineRowSchema.parse(r);
  });
});

describe("sandbox procedures when WHATSAPP_MODE=meta", () => {
  it("are FORBIDDEN even for a fully-permitted volunteer", async () => {
    const m = await makeTestDeps({
      config: { WHATSAPP_MODE: "meta", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_APP_SECRET: "s", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_VERIFY_TOKEN: "v" },
    });
    try {
      registerWaDeps({ ...m.deps, beneficiaries: m.services.beneficiaries, documents: m.services.documents, letters: {} } as unknown as WaDeps);
      const v = await createVolunteer(m.deps, { role: "admin" });
      const { client } = makeClient(m.deps);
      await client.auth.login({ email: v.email, password: v.password });
      expect(await client.system.health()).toMatchObject({ mode: "meta" });
      for (const p of ALL.filter((p) => p.startsWith("sandbox."))) {
        expect([p, await code(call(client, p, INPUTS[p]))]).toEqual([p, "FORBIDDEN"]);
      }
    } finally {
      await m.close();
    }
  });
});
