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
  "auth.searchAssociations": { query: "secours" },
  "auth.signup": { name: "Coverage", email: "coverage-signup@example.org", password: "long-enough-pass", uiLanguage: "fr", acceptsConfidentiality: true },
  "auth.invitation": { token: "x".repeat(32) },
  "auth.logout": undefined,
  "auth.me": undefined,
  "auth.setUiLanguage": { language: "fr" },
  "auth.verifyEmail": { token: "x".repeat(43) },
  "auth.resetPassword": { token: "x".repeat(43), password: "long-enough-pass" },
  "auth.finishWelcome": undefined,
  "auth.twoFactorSetup": undefined,
  "auth.twoFactorEnable": { code: "123456" },
  "auth.twoFactorDisable": { code: "123456" },
  "letters.list": { limit: 5 },
  "letters.get": { id },
  "letters.photo": { id },
  "letters.edit": { id },
  "letters.approve": { id },
  "letters.reject": { id },
  "beneficiaries.list": { limit: 5 },
  "beneficiaries.get": { id },
  "beneficiaries.setLanguage": { id, language: "fr" },
  "beneficiaries.setNickname": { id, nickname: "Ali" },
  "quickReplies.list": undefined,
  "quickReplies.create": { title: "Bonjour", text: "Bonjour !" },
  "quickReplies.update": { id, title: "Bonjour", text: "Bonjour !" },
  "quickReplies.remove": { id },
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
  "conversations.attentionCount": undefined,
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
  "volunteers.resetTwoFactor": { id },
  "volunteers.passwordResetLink": { id },
  "volunteers.setPermissions": { id, overrides: [{ permission: "places.manage", granted: false }] },
  "associations.list": undefined,
  "associations.create": { name: "Coverage asso", siren: null, rna: null, city: null },
  "associations.setMember": { volunteerId: id, associationId: null },
  "associations.setAdmin": { volunteerId: id, associationId: id, admin: true },
  "invitations.list": undefined,
  "invitations.create": { role: "responder" },
  "invitations.revoke": { id },
  "places.list": { scope: "today" },
  "places.create": { kind: "food", name: "Distribution", startsOn: "2026-11-06" },
  "places.update": { id, place: { kind: "food", name: "Distribution", startsOn: "2026-11-06" } },
  "places.remove": { id },
  "places.preview": { language: "en" },
  "broadcasts.list": undefined,
  "broadcasts.estimate": { languages: null },
  "broadcasts.create": { textFr: "Permanence juridique samedi" },
  "broadcasts.update": { id, broadcast: { textFr: "Permanence juridique samedi" } },
  "broadcasts.preview": { id, language: "en" },
  "broadcasts.approve": { id },
  "broadcasts.cancel": { id },
  "usage.summary": undefined,
  "usage.setBudget": { monthlyLimitUsd: 50, hardStop: false },
  "usage.listKeys": undefined,
  "usage.addKey": { label: "Coverage", apiKey: "sk-ant-api03-coverageXXXXXXXXXXXXXXXX", monthlyLimitUsd: 10 },
  "usage.updateKey": { id, label: "x" },
  "usage.removeKey": { id },
  "notes.list": { beneficiaryId: id },
  "notes.add": { beneficiaryId: id, text: "Note" },
  "notes.edit": { id, text: "Note" },
  "notes.remove": { id },
  "tasks.list": { filter: "mine" },
  "tasks.dueCount": undefined,
  "tasks.add": { beneficiaryId: id, text: "Rappeler" },
  "tasks.update": { id, status: "done" },
  "skills.mine": undefined,
  "skills.updateMine": { languages: ["ar"], skills: ["interpreting"], note: null },
  "skills.directory": {},
  "skills.suggest": { beneficiaryId: id },
  "skills.updateFor": { volunteerId: id, languages: [], skills: [], note: null },
  "numbers.list": { status: "quarantined" },
  "numbers.heldCount": undefined,
  "numbers.release": { beneficiaryId: id },
  "numbers.releaseAllGlobal": undefined,
  "numbers.block": { beneficiaryId: id },
  "numbers.unblock": { beneficiaryId: id },
  "buddies.myProfile": undefined,
  "buddies.saveProfile": { active: true, languages: ["ar"], slots: [{ weekday: 2, time: "18:30" }], modes: ["meet"], maxBuddies: 1, meetPlace: "Local" },
  "buddies.requests": undefined,
  "buddies.candidates": { requestId: id },
  "buddies.propose": { requestId: id, weekday: 2, time: "18:30", mode: "meet" },
  "buddies.mine": undefined,
  "buddies.all": {},
  "buddies.get": { id },
  "buddies.sendMessage": { matchId: id, text: "Bonjour" },
  "buddies.skipSession": { sessionId: id },
  "buddies.end": { matchId: id },
  "buddies.contact": { matchId: id },
  "buddies.report": { matchId: id, text: "Un problème" },
  "buddies.reports": {},
  "buddies.resolveReport": { id, action: "resume" },
  "buddies.counts": undefined,
  "system.health": undefined,
  "appointments.list": { view: "open" },
  "appointments.counts": undefined,
  "appointments.accept": { id, meetingPoint: "Devant l'entrée" },
  "appointments.release": { id },
  "appointments.complete": { id },
  "appointments.cancel": { id },
  "appointments.documents": { id },
  "appointments.documentFile": { id, documentId: id },
  "appointments.slots": { scope: "mine" },
  "appointments.addSlot": { startsAt: "2030-01-15T13:00:00.000Z", durationMin: 60, place: "Local de l'association" },
  "appointments.removeSlot": { id },
};
/** The permission(s) each procedure needs (the router's `requirePermission`). null = any logged-in volunteer. */
const REQUIRES: Record<string, Permission | Permission[] | null> = {
  "auth.me": null, "auth.setUiLanguage": null, "auth.finishWelcome": null,
  "auth.twoFactorSetup": null, "auth.twoFactorEnable": null, "auth.twoFactorDisable": null,
  "letters.list": "letters.review", "letters.get": "letters.review", "letters.edit": "letters.review",
  "letters.approve": "letters.review", "letters.reject": "letters.review", "letters.photo": "letters.view_photo",
  "beneficiaries.list": "beneficiaries.view", "beneficiaries.get": "beneficiaries.view", "beneficiaries.setLanguage": "beneficiaries.edit",
  "beneficiaries.setNickname": "conversations.reply",
  "quickReplies.list": "conversations.reply", "quickReplies.create": "replies.manage", "quickReplies.update": "replies.manage", "quickReplies.remove": "replies.manage",
  "documents.deadlines": "documents.view_metadata", "documents.file": "documents.view_file",
  "documents.update": "documents.edit", "documents.archive": "documents.edit",
  "sandbox.send": "sandbox.use", "sandbox.thread": "sandbox.use", "sandbox.runReminders": "sandbox.use", "sandbox.reset": "sandbox.use",
  "knowledge.sources": "knowledge.view", "knowledge.search": "knowledge.view", "knowledge.sync": "knowledge.manage",
  "conversations.list": "conversations.view", "conversations.attentionCount": "conversations.view", "conversations.get": "conversations.view",
  "conversations.approveDraft": "conversations.reply", "conversations.rejectDraft": "conversations.reply",
  "conversations.reply": "conversations.reply", "conversations.resolve": "conversations.reply", "conversations.takeOver": "conversations.reply",
  "volunteers.list": "volunteers.manage", "volunteers.approve": "volunteers.manage", "volunteers.reject": "volunteers.manage",
  "volunteers.setRole": "volunteers.manage", "volunteers.setDisabled": "volunteers.manage", "volunteers.setPermissions": "volunteers.manage", "volunteers.resetTwoFactor": "volunteers.manage", "volunteers.passwordResetLink": "volunteers.manage",
  "associations.list": "associations.manage", "associations.create": "associations.manage",
  "associations.setMember": "associations.manage", "associations.setAdmin": "associations.manage",
  // members.manage also opens these, but only with an association (scoping tested in associations.admin.test.ts).
  "invitations.list": "volunteers.manage", "invitations.create": "volunteers.manage", "invitations.revoke": "volunteers.manage",
  "places.list": "places.view", "places.preview": "places.view",
  "places.create": "places.manage", "places.update": "places.manage", "places.remove": "places.manage",
  "broadcasts.list": "broadcasts.view", "broadcasts.estimate": "broadcasts.view", "broadcasts.preview": "broadcasts.view",
  // cancel: needs view, then the author (broadcasts.create) or broadcasts.approve; tested in broadcasts.test.ts.
  "broadcasts.cancel": "broadcasts.view",
  "broadcasts.create": "broadcasts.create", "broadcasts.update": "broadcasts.create",
  "broadcasts.approve": "broadcasts.approve",
  "usage.summary": "usage.manage", "usage.setBudget": "usage.manage", "usage.listKeys": "usage.manage",
  "usage.addKey": "usage.manage", "usage.updateKey": "usage.manage", "usage.removeKey": "usage.manage",
  "notes.list": "notes.view", "notes.add": "notes.write", "notes.edit": "notes.write", "notes.remove": "notes.write",
  "tasks.list": "notes.view", "tasks.dueCount": "notes.view", "tasks.add": "notes.write", "tasks.update": "notes.write",
  "skills.mine": "skills.edit_own", "skills.updateMine": "skills.edit_own", "skills.directory": "skills.view",
  "skills.suggest": "skills.view", "skills.updateFor": "volunteers.manage",
  // buddies: null here = allowed by any one of several buddy permissions (requests, get, end, counts), so revoking a single one never forbids it.
  "buddies.myProfile": "buddies.be_buddy", "buddies.saveProfile": "buddies.be_buddy", "buddies.mine": "buddies.be_buddy",
  "buddies.propose": "buddies.be_buddy", // proposing oneself; proposing someone else needs buddies.manage (buddies.test.ts)
  "buddies.sendMessage": "buddies.be_buddy", "buddies.skipSession": "buddies.be_buddy", "buddies.contact": "buddies.be_buddy", "buddies.report": "buddies.be_buddy",
  "buddies.candidates": "buddies.manage", "buddies.all": "buddies.manage",
  "buddies.reports": "buddies.reports", "buddies.resolveReport": "buddies.reports",
  "buddies.requests": null, "buddies.get": null, "buddies.end": null, "buddies.counts": null,
  "appointments.list": "appointments.view", "appointments.counts": "appointments.view",
  "appointments.accept": ["appointments.view", "appointments.accept"], "appointments.release": ["appointments.view", "appointments.accept"],
  "appointments.complete": ["appointments.view", "appointments.accept"], "appointments.cancel": ["appointments.view", "appointments.manage"],
  "appointments.documents": "appointments.documents", "appointments.documentFile": "appointments.documents",
  "appointments.slots": "appointments.slots", "appointments.addSlot": "appointments.slots", "appointments.removeSlot": "appointments.slots",
  "numbers.list": "numbers.moderate", "numbers.heldCount": "numbers.moderate", "numbers.release": "numbers.moderate",
  "numbers.releaseAllGlobal": "numbers.moderate", "numbers.block": "numbers.moderate", "numbers.unblock": "numbers.moderate",
};
const needs = (req: Permission | Permission[] | null, perm: Permission) => (Array.isArray(req) ? req.includes(perm) : req === perm);
const PUBLIC = new Set(["auth.login", "auth.signup", "auth.searchAssociations", "auth.verifyEmail", "auth.resetPassword", "auth.invitation", "system.health"]);
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

  it("every procedure except auth.login / auth.signup / auth.searchAssociations / auth.invitation / system.health / (idempotent) auth.logout rejects an anonymous caller with UNAUTHORIZED", async () => {
    const { client } = makeClient(t.deps);
    for (const p of ALL.filter((p) => !ANON_OK.has(p))) {
      expect([p, await code(call(client, p, INPUTS[p]))]).toEqual([p, "UNAUTHORIZED"]);
    }
    expect(await code(call(client, "auth.logout"))).toBe("ok");
    expect(await call(client, "system.health")).toMatchObject({ ok: true });
  });

  it("a volunteer whose permission was revoked gets FORBIDDEN on exactly the procedures needing it", async () => {
    const needed = [...new Set(Object.values(REQUIRES).flatMap((p) => (p === null ? [] : Array.isArray(p) ? p : [p])))];
    for (const perm of needed) {
      const v = await createVolunteer(t.deps);
      await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: perm, granted: false });
      // knowledge.manage / volunteers.manage are admin-only by role: grant them per-volunteer so every other procedure starts allowed.
      for (const adminOnly of ["knowledge.manage", "volunteers.manage", "associations.manage", "usage.manage", "replies.manage", "broadcasts.approve", "buddies.manage", "buddies.reports", "appointments.manage"] as const) {
        if (perm !== adminOnly) await t.deps.db.insert(volunteerPermissions).values({ volunteerId: v.id, permission: adminOnly, granted: true });
      }
      const { client } = makeClient(t.deps);
      await client.auth.login({ email: v.email, password: v.password });
      for (const [proc, req] of Object.entries(REQUIRES)) {
        const c = await code(call(client, proc, INPUTS[proc]));
        if (needs(req, perm)) expect([perm, proc, c]).toEqual([perm, proc, "FORBIDDEN"]);
        else expect([perm, proc, c]).not.toEqual([perm, proc, "FORBIDDEN"]);
      }
    }
    // One volunteer per permission × every procedure: about 2,000 calls, more than bun's 5 s default on CI runners.
  }, 30_000);

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
