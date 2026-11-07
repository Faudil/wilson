import { afterEach, describe, expect, it } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { LANGUAGE_CODES, type Permission } from "@wilson/contracts";
import { accessLog, beneficiaries, caseNotes, caseTasks, volunteerPermissions } from "../src/db/schema.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type Client, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

async function login(e: E2E, v: { role?: "volunteer" | "admin" | "responder"; name?: string; revoke?: Permission[] } = {}) {
  const row = await createVolunteer(e.deps, { role: v.role as "volunteer", name: v.name });
  for (const p of v.revoke ?? []) await e.deps.db.insert(volunteerPermissions).values({ volunteerId: row.id, permission: p, granted: false });
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: row.email, password: row.password });
  return { id: row.id, client };
}

/** An Arabic speaker who asked a legal question in the chat. */
async function arabicLegal(e: E2E, phone = "33630000001") {
  const p = e.phone(phone);
  await p.say("?");
  await p.say(String(LANGUAGE_CODES.indexOf("ar") + 1));
  await p.say("4");
  await p.say("j'ai besoin d'un avocat pour mon recours");
  return beneficiaryIdOf(e, phone);
}

const logged = (e: E2E, volunteerId: string, prefix: string) =>
  e.deps.db.select().from(accessLog).where(and(eq(accessLog.volunteerId, volunteerId), like(accessLog.action, `${prefix}%`)));

describe("role defaults for the new permissions", () => {
  it("responders only fill in their own skills; volunteers read/write notes, assign tasks and see the directory; only admins moderate", async () => {
    t = await makeE2E();
    const responder = await login(t, { role: "responder" });
    const volunteer = await login(t, { role: "volunteer" });
    const admin = await login(t, { role: "admin" });
    const news = (c: Client) => c.auth.me().then((m) => m.permissions.filter((p) => /^(notes|tasks|skills)\./.test(p)).sort());
    expect(await news(responder.client)).toEqual(["skills.edit_own"]);
    expect(await news(volunteer.client)).toEqual(["notes.view", "notes.write", "skills.edit_own", "skills.view", "tasks.assign"]);
    expect(await news(admin.client)).toEqual(["notes.moderate", "notes.view", "notes.write", "skills.edit_own", "skills.view", "tasks.assign"]);

    const bid = await arabicLegal(t);
    expect(await code(responder.client.notes.list({ beneficiaryId: bid }))).toBe("FORBIDDEN");
    expect(await code(responder.client.notes.add({ beneficiaryId: bid, text: "x" }))).toBe("FORBIDDEN");
    expect(await code(responder.client.tasks.list({}))).toBe("FORBIDDEN");
    expect(await code(responder.client.tasks.dueCount())).toBe("FORBIDDEN");
    expect(await code(responder.client.skills.directory({}))).toBe("FORBIDDEN");
    expect(await code(responder.client.skills.suggest({ beneficiaryId: bid }))).toBe("FORBIDDEN");
    expect(await code(responder.client.skills.mine())).toBe("ok");
  });
});

describe("case notes", () => {
  it("are encrypted at rest, readable by volunteers, editable only by their author or a moderator, and every access is logged", async () => {
    t = await makeE2E();
    const bid = await arabicLegal(t);
    const a = await login(t, { name: "Awa Autrice" });
    const b = await login(t, { name: "Bilal Bénévole" });
    const mod = await login(t, { role: "admin", name: "Mona Modératrice" });

    const note = await a.client.notes.add({ beneficiaryId: bid, text: "Entretien OFPRA le 12/12, a peur de parler de son parcours." });
    expect(note).toMatchObject({ author: { id: a.id, name: "Awa Autrice" }, canEdit: true, editedAt: null });
    const [row] = await t.deps.db.select().from(caseNotes).where(eq(caseNotes.id, note.id));
    expect(row!.bodyEnc.toString("utf8")).not.toContain("OFPRA");
    expect(row!.bodyEnc.toString("latin1")).not.toContain("OFPRA");

    const seen = await b.client.notes.list({ beneficiaryId: bid });
    expect(seen.notes.map((n) => [n.text, n.canEdit])).toEqual([["Entretien OFPRA le 12/12, a peur de parler de son parcours.", false]]);
    expect(await code(b.client.notes.edit({ id: note.id, text: "changé" }))).toBe("FORBIDDEN");
    expect(await code(b.client.notes.remove({ id: note.id }))).toBe("FORBIDDEN");

    const edited = await a.client.notes.edit({ id: note.id, text: "Entretien OFPRA le 12/12." });
    expect(edited.editedAt).not.toBeNull();
    expect((await mod.client.notes.list({ beneficiaryId: bid })).notes[0]!.canEdit).toBe(true);
    await mod.client.notes.edit({ id: note.id, text: "[retiré par la modération]" });
    await mod.client.notes.remove({ id: note.id });
    expect((await a.client.notes.list({ beneficiaryId: bid })).notes).toEqual([]);

    expect((await logged(t, a.id, "notes.")).map((l) => l.action)).toEqual(["notes.add", "notes.edit", "notes.view"]);
    expect((await logged(t, b.id, "notes.")).map((l) => l.action)).toEqual(["notes.view"]);
    expect((await logged(t, mod.id, "notes.")).map((l) => l.action).sort()).toEqual(["notes.edit_moderated", "notes.remove_moderated", "notes.view"]);
    expect((await logged(t, b.id, "notes.view"))[0]!.targetId).toBe(bid);
  });

  it("notes.write without notes.view can add but not read; a revoked notes.write is FORBIDDEN; an erased person is NOT_FOUND", async () => {
    t = await makeE2E();
    const bid = await arabicLegal(t);
    const writeOnly = await login(t, { revoke: ["notes.view"] });
    const readOnly = await login(t, { revoke: ["notes.write"] });
    expect(await code(writeOnly.client.notes.add({ beneficiaryId: bid, text: "Appel passé." }))).toBe("ok");
    expect(await code(writeOnly.client.notes.list({ beneficiaryId: bid }))).toBe("FORBIDDEN");
    expect(await code(readOnly.client.notes.add({ beneficiaryId: bid, text: "x" }))).toBe("FORBIDDEN");
    expect(await code(readOnly.client.tasks.add({ beneficiaryId: bid, text: "x" }))).toBe("FORBIDDEN");
    expect((await readOnly.client.notes.list({ beneficiaryId: bid })).notes).toHaveLength(1);

    // crypto-shredding: once the data key is gone, notes are unreadable and the person is not found
    await t.deps.db.update(beneficiaries).set({ wrappedDek: null }).where(eq(beneficiaries.id, bid));
    expect(await code(readOnly.client.notes.list({ beneficiaryId: bid }))).toBe("NOT_FOUND");
  });
});

describe("follow-up tasks", () => {
  it("reminder day → due badge; assigning to others needs tasks.assign and an assignee who can read notes", async () => {
    t = await makeE2E({ now: "2026-11-09T20:00:00Z" }); // sessions last 12 h: the reminder morning is 11 h later
    const bid = await arabicLegal(t);
    const me = await login(t, { name: "Moi Même" });
    const other = await login(t, { name: "Olga Autre" });
    const noAssign = await login(t, { revoke: ["tasks.assign"] });
    const responder = await login(t, { role: "responder", name: "Rémi Répondant" });

    const task = await me.client.tasks.add({ beneficiaryId: bid, text: "Rappeler après l'entretien OFPRA", dueOn: "2026-11-10", assigneeId: me.id });
    expect(task).toMatchObject({ due: false, status: "open", assignee: { id: me.id }, createdBy: { id: me.id }, beneficiaryLabel: expect.stringContaining("01") });
    const [row] = await t.deps.db.select().from(caseTasks).where(eq(caseTasks.id, task.id));
    expect(row!.textEnc.toString("latin1")).not.toContain("OFPRA");
    expect((await me.client.tasks.dueCount()).count).toBe(0);

    t.clock.set("2026-11-10T07:00:00Z"); // 08:00 in Paris on the reminder day
    expect((await me.client.tasks.dueCount()).count).toBe(1);
    expect((await me.client.tasks.list({ filter: "mine" }))[0]).toMatchObject({ id: task.id, due: true, text: "Rappeler après l'entretien OFPRA" });
    expect((await other.client.tasks.dueCount()).count).toBe(0);

    // giving a task to someone else
    expect(await code(noAssign.client.tasks.add({ beneficiaryId: bid, text: "x", assigneeId: other.id }))).toBe("FORBIDDEN");
    expect(await code(noAssign.client.tasks.add({ beneficiaryId: bid, text: "Pour moi", assigneeId: noAssign.id }))).toBe("ok");
    expect(await code(noAssign.client.tasks.update({ id: task.id, assigneeId: noAssign.id }))).toBe("FORBIDDEN");
    await expect(me.client.tasks.add({ beneficiaryId: bid, text: "x", assigneeId: responder.id }))
      .rejects.toMatchObject({ code: "CONFLICT", data: { reason: "assignee_cannot_view" } });
    const given = await me.client.tasks.add({ beneficiaryId: bid, text: "Trouver un interprète arabe", dueOn: "2026-11-09", assigneeId: other.id });
    expect((await other.client.tasks.dueCount()).count).toBe(1);
    expect((await me.client.tasks.list({ filter: "created" })).map((x) => x.id)).toEqual([given.id]);

    // the assignee ticks it done but cannot rewrite the creator's text
    expect(await code(other.client.tasks.update({ id: given.id, text: "autre chose" }))).toBe("FORBIDDEN");
    const done = await other.client.tasks.update({ id: given.id, status: "done" });
    expect(done).toMatchObject({ status: "done", due: false, doneBy: { id: other.id, name: "Olga Autre" } });
    expect((await other.client.tasks.dueCount()).count).toBe(0);
    expect(await other.client.tasks.list({ filter: "mine" })).toEqual([]);
    expect((await other.client.tasks.list({ filter: "mine", includeClosed: true })).map((x) => x.id)).toEqual([given.id]);

    // unassigned tasks are visible to everyone in "unassigned"
    const free = await me.client.tasks.add({ beneficiaryId: bid, text: "Accompagner à la préfecture" });
    expect((await other.client.tasks.list({ filter: "unassigned" })).map((x) => x.id)).toEqual([free.id]);
    expect((await other.client.tasks.update({ id: free.id, assigneeId: other.id })).assignee?.id).toBe(other.id);

    const file = await me.client.notes.list({ beneficiaryId: bid });
    expect(file.tasks.map((x) => x.status)).toEqual(["open", "open", "open", "done"]);
    expect((await logged(t, me.id, "tasks.add")).map((l) => l.action).sort()).toEqual(["tasks.add", "tasks.add", "tasks.add_assigned"]);
    expect((await logged(t, other.id, "tasks.update")).map((l) => l.action)).toEqual(expect.arrayContaining(["tasks.update:status=done", "tasks.update:assignee"]));
  });
});

describe("skills directory", () => {
  it("own profile, directory filters, and suggestions for a hard case ranked by language and skills", async () => {
    t = await makeE2E();
    const bid = await arabicLegal(t);
    const lawyer = await login(t, { name: "Leïla Juriste" });
    const driver = await login(t, { name: "Damien Chauffeur" });
    const responder = await login(t, { role: "responder", name: "Rania Répondante" });
    const gone = await login(t, { name: "Zoé Partie" });
    const admin = await login(t, { role: "admin", name: "Admin" });

    expect(await lawyer.client.skills.mine()).toEqual({ languages: [], skills: [], note: null, updatedAt: null });
    const mine = await lawyer.client.skills.updateMine({ languages: ["ar", "fa", "ar"], skills: ["legal", "asylum"], note: "Mardi soir" });
    expect(mine).toMatchObject({ languages: ["ar", "fa"], skills: ["legal", "asylum"], note: "Mardi soir" });
    await driver.client.skills.updateMine({ languages: ["en"], skills: ["driving", "accompaniment"], note: null });
    await responder.client.skills.updateMine({ languages: ["ar"], skills: ["interpreting"], note: null });
    await gone.client.skills.updateMine({ languages: ["ar"], skills: ["legal"], note: null });
    await admin.client.volunteers.setDisabled({ id: gone.id, disabled: true });

    const all = await admin.client.skills.directory({});
    expect(all.map((e) => e.name)).toEqual(["Damien Chauffeur", "Leïla Juriste", "Rania Répondante"]);
    expect(all.find((e) => e.name === "Rania Répondante")).toMatchObject({ role: "responder", canTakeTasks: false });
    expect((await lawyer.client.skills.directory({ language: "ar" })).map((e) => e.name)).toEqual(["Leïla Juriste", "Rania Répondante"]);
    expect((await lawyer.client.skills.directory({ skill: "driving" })).map((e) => e.name)).toEqual(["Damien Chauffeur"]);

    const s = await driver.client.skills.suggest({ beneficiaryId: bid });
    expect(s.language).toBe("ar");
    expect(s.wanted.sort()).toEqual(["asylum", "interpreting", "legal"]);
    expect(s.volunteers.map((v) => [v.name, v.speaksLanguage, v.matchedSkills.sort()])).toEqual([
      ["Leïla Juriste", true, ["asylum", "legal"]],
      ["Rania Répondante", true, ["interpreting"]],
    ]);

    // admins can fill in someone else's profile; others cannot
    expect(await code(lawyer.client.skills.updateFor({ volunteerId: driver.id, languages: [], skills: [], note: null }))).toBe("FORBIDDEN");
    expect((await admin.client.skills.updateFor({ volunteerId: driver.id, languages: ["en", "es"], skills: ["driving"], note: null })).languages).toEqual(["en", "es"]);
    expect((await logged(t, admin.id, "skills.update_for")).map((l) => l.targetId)).toEqual([driver.id]);
    expect(await code(admin.client.skills.suggest({ beneficiaryId: "00000000-0000-4000-8000-000000000000" }))).toBe("NOT_FOUND");
  });
});
