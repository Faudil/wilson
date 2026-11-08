import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { associations, volunteers } from "../src/db/schema.js";
import { JOBS } from "../src/jobs/names.js";
import { setMailer } from "../src/mail.js";
import { getNews } from "../src/team/news.js";
import { createVolunteer, makeClient, makeTestDeps, type TestCtx } from "./helpers.js";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; data?: { reason?: string } }) => (e.data?.reason ? `${e.code}:${e.data.reason}` : (e.code ?? "error")));

let t: TestCtx;
const mails: { to: string; subject: string; text: string }[] = [];
beforeAll(async () => {
  t = await makeTestDeps({ now: "2026-11-08T10:00:00Z" });
  setMailer(t.deps, { send: async (to, subject, text) => void mails.push({ to, subject, text }) });
  await t.queue.registerWorker(JOBS.newsEmail, async (p) => void (await getNews(t.deps).sendEmails(p.postId)));
});
afterAll(() => t.close());

async function loggedIn(v: { email: string; password: string }) {
  const { client } = makeClient(t.deps);
  await client.auth.login({ email: v.email, password: v.password });
  return client;
}

async function member(name: string, associationId: string | null, opts: { admin?: boolean; role?: "volunteer" | "admin" } = {}) {
  const v = await createVolunteer(t.deps, { name, role: opts.role });
  await t.deps.db.update(volunteers).set({ associationId, associationAdmin: !!opts.admin }).where(eq(volunteers.id, v.id));
  return v;
}

let A: string;
let B: string;
let globalAdmin: Awaited<ReturnType<typeof createVolunteer>>;
let adminA: Awaited<ReturnType<typeof createVolunteer>>;
let samiraA: Awaited<ReturnType<typeof createVolunteer>>;
let lucB: Awaited<ReturnType<typeof createVolunteer>>;

beforeAll(async () => {
  [{ id: A }, { id: B }] = await t.deps.db.insert(associations).values([{ name: "Asso A" }, { name: "Asso B" }]).returning({ id: associations.id }) as [{ id: string }, { id: string }];
  globalAdmin = await member("Global", null, { role: "admin" });
  adminA = await member("Fatima", A, { admin: true });
  samiraA = await member("Samira", A);
  lucB = await member("Luc", B);
});

describe("team news", () => {
  let everyonePost: string;
  let postA: string;

  it("a global admin posts to everyone; each volunteer sees it unread until opened", async () => {
    const g = await loggedIn(globalAdmin);
    const p = await g.news.create({ title: "Nouvelle procédure CAF", body: "Les dossiers se font en ligne.", associationId: null });
    everyonePost = p.id;
    expect(p.association).toBeNull();
    expect(p.canEdit).toBe(true);
    expect(p.reads).toEqual({ seen: 0, audience: 3 });

    const s = await loggedIn(samiraA);
    const u = await s.news.unread();
    expect(u.count).toBe(1);
    expect(u.latest[0]).toMatchObject({ title: "Nouvelle procédure CAF", read: false, canEdit: false, reads: null, authorName: "Global" });
    await s.news.markRead({ ids: [everyonePost] });
    expect((await s.news.unread()).count).toBe(0);
    expect((await g.news.list({})).find((x) => x.id === everyonePost)!.reads).toEqual({ seen: 1, audience: 3 });
  });

  it("an association admin posts to their own association only", async () => {
    const f = await loggedIn(adminA);
    const p = await f.news.create({ title: "Permanence fermée lundi", body: "Pas de permanence le 10 novembre.", pinned: true });
    postA = p.id;
    expect(p.association).toEqual({ id: A, name: "Asso A" });
    expect(p.reads).toEqual({ seen: 0, audience: 1 }); // Samira (Fatima wrote it)
    expect(await code(f.news.create({ title: "À tous", body: "x", associationId: null }))).toBe("FORBIDDEN");
    expect(await code(f.news.create({ title: "Chez B", body: "x", associationId: B }))).toBe("FORBIDDEN");

    const s = await loggedIn(samiraA);
    const list = await s.news.list({});
    expect(list.map((x) => x.title)).toEqual(["Permanence fermée lundi", "Nouvelle procédure CAF"]); // pinned first
    const l = await loggedIn(lucB);
    expect((await l.news.list({})).map((x) => x.title)).toEqual(["Nouvelle procédure CAF"]);
    // Luc cannot mark a post he cannot see (ignored, not an error), and it stays out of his list.
    await l.news.markRead({ ids: [postA] });
    // The global admin sees every association's posts, but only theirs count as unread.
    const g = await loggedIn(globalAdmin);
    expect((await g.news.list({})).map((x) => x.id)).toContain(postA);
    expect((await g.news.unread()).count).toBe(0);
  });

  it("volunteers cannot post; association admins edit their association's posts but not the global ones", async () => {
    const s = await loggedIn(samiraA);
    expect(await code(s.news.create({ title: "Moi", body: "x" }))).toBe("FORBIDDEN");
    const f = await loggedIn(adminA);
    expect(await code(f.news.update({ id: everyonePost, title: "Changé", body: "x", pinned: false }))).toBe("FORBIDDEN");
    expect(await code(f.news.remove({ id: everyonePost }))).toBe("FORBIDDEN");
    const edited = await f.news.update({ id: postA, title: "Permanence fermée lundi 10", body: "Pas de permanence.", pinned: false });
    expect(edited.editedAt).not.toBeNull();
    expect(edited.pinned).toBe(false);
    const l = await loggedIn(lucB);
    expect(await code(l.news.remove({ id: postA }))).toBe("FORBIDDEN"); // no news.post at all
    await f.news.remove({ id: postA });
    expect((await s.news.list({})).map((x) => x.id)).not.toContain(postA);
  });

  it("'also by e-mail' sends one e-mail per reader, not to the author nor to other associations", async () => {
    const f = await loggedIn(adminA);
    mails.length = 0;
    const p = await f.news.create({ title: "Réunion jeudi", body: "Réunion d'équipe jeudi 19 h.", email: true });
    expect(p.emailedAt).not.toBeNull();
    await t.queue.drain();
    expect(mails.map((m) => m.to)).toEqual([samiraA.email]);
    expect(mails[0]!.subject).toContain("Réunion jeudi");
    expect(mails[0]!.text).toContain("#/news");
  });
});

describe("calls for backup", () => {
  let callId: string;

  it("a call reaches the author's association; people whose profile matches see it 'for me'", async () => {
    const s = await loggedIn(samiraA);
    await s.skills.updateMine({ languages: ["ar", "fr"], skills: [], note: null });
    const f = await loggedIn(adminA);
    const c = await f.backup.create({ title: "Interprète arabe à la préfecture", neededOn: "2026-11-09", startsAt: "10:00", place: "Préfecture de Bobigny", languages: ["ar"] });
    callId = c.id;
    expect(c).toMatchObject({ mine: true, forMe: false, status: "open", offerCount: 0, offers: [], canClose: true, association: { id: A, name: "Asso A" } });
    expect(await s.backup.counts()).toEqual({ open: 1, forMe: 1 });
    const [seen] = await s.backup.list({});
    expect(seen).toMatchObject({ id: callId, forMe: true, offered: false, offers: null, canClose: false });
    // Another association does not see it.
    const l = await loggedIn(lucB);
    expect(await l.backup.list({})).toEqual([]);
    expect(await code(l.backup.offer({ id: callId }))).toBe("NOT_FOUND");
  });

  it("offering help: the author sees who and the note; nobody offers on their own call", async () => {
    const s = await loggedIn(samiraA);
    const after = await s.backup.offer({ id: callId, note: "Je peux à partir de 10 h 30" });
    expect(after).toMatchObject({ offered: true, offerCount: 1, offers: null });
    expect(await s.backup.counts()).toEqual({ open: 0, forMe: 0 });
    expect((await s.backup.list({ scope: "mine" })).map((c) => c.id)).toEqual([callId]);
    const f = await loggedIn(adminA);
    const [mine] = await f.backup.list({ scope: "mine" });
    expect(mine!.offers).toEqual([expect.objectContaining({ name: "Samira", note: "Je peux à partir de 10 h 30" })]);
    expect(await code(f.backup.offer({ id: callId }))).toBe("CONFLICT:own_call");
    // Withdraw and offer again.
    expect((await s.backup.withdraw({ id: callId })).offered).toBe(false);
    await s.backup.offer({ id: callId });
  });

  it("only the author or an admin closes it; once covered nobody can offer", async () => {
    const s = await loggedIn(samiraA);
    expect(await code(s.backup.close({ id: callId, status: "covered" }))).toBe("FORBIDDEN");
    const f = await loggedIn(adminA);
    expect((await f.backup.close({ id: callId, status: "covered" })).status).toBe("covered");
    expect(await code(f.backup.close({ id: callId, status: "cancelled" }))).toBe("CONFLICT:not_open");
    expect(await code(s.backup.offer({ id: callId }))).toBe("CONFLICT:not_open");
    expect(await s.backup.list({})).toEqual([]);
    expect((await s.backup.list({ scope: "past" })).map((c) => c.id)).toEqual([callId]);
  });

  it("open to all reaches the other associations; a past day leaves the list", async () => {
    const l = await loggedIn(lucB);
    expect(await code(l.backup.create({ title: "Hier", neededOn: "2026-11-07" }))).toBe("CONFLICT:past_date");
    const c = await l.backup.create({ title: "Chauffeur pour un déménagement", neededOn: "2026-11-08", skills: ["driving"], openToAll: true });
    const s = await loggedIn(samiraA);
    expect((await s.backup.list({})).map((x) => x.id)).toEqual([c.id]);
    // The global admin can cancel any call.
    const g = await loggedIn(globalAdmin);
    expect((await g.backup.list({}))[0]!.canClose).toBe(true);
    t.clock.set("2026-11-09T09:00:00Z");
    const next = await loggedIn(samiraA); // sessions expire after a night idle
    expect(await next.backup.list({})).toEqual([]);
    expect(await code(next.backup.offer({ id: c.id }))).toBe("CONFLICT:not_open");
    t.clock.set("2026-11-08T10:00:00Z");
  });

  it("responders can ask for backup and read the news too", async () => {
    const r = await createVolunteer(t.deps, { name: "Nouveau" });
    await t.deps.db.update(volunteers).set({ role: "responder", associationId: A }).where(eq(volunteers.id, r.id));
    const c = await loggedIn(r);
    expect((await c.news.list({})).length).toBeGreaterThan(0);
    expect((await c.backup.create({ title: "Quelqu'un pour la permanence", neededOn: "2026-11-10" })).mine).toBe(true);
  });
});

describe("what's new", () => {
  it("remembers the newest entry seen and never goes back", async () => {
    const s = await loggedIn(samiraA);
    expect((await s.auth.me()).changelogSeen).toBeNull();
    expect((await s.auth.markChangelogSeen({ id: "2026-11-08" })).changelogSeen).toBe("2026-11-08");
    expect((await s.auth.markChangelogSeen({ id: "2026-10-01" })).changelogSeen).toBe("2026-11-08");
    expect((await s.auth.markChangelogSeen({ id: "2026-11-08b" })).changelogSeen).toBe("2026-11-08b");
  });
});
