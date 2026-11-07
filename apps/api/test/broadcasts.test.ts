import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { getBroadcasts } from "../src/broadcasts/service.js";
import { processInbound } from "../src/conversation/engine.js";
import { accessLog, beneficiaries, broadcastRecipients } from "../src/db/schema.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type E2E } from "./e2e.helpers.js";
import { makeWa, type WaCtx } from "./wa.helpers.js";

let t: E2E | undefined;
let w: WaCtx | undefined;
afterEach(async () => {
  await t?.close();
  await w?.close();
  t = undefined;
  w = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; data?: { reason?: string } }) => (e.data?.reason ? `${e.code}:${e.data.reason}` : (e.code ?? "error")));
const TEXT = "Permanence juridique gratuite samedi 14 novembre de 10h à 13h, 12 rue de l'Exemple.";

async function person(e: E2E, phone: string, lang: "en" | "ar" | "fr", optIn: boolean) {
  const p = e.phone(phone);
  await p.say("?");
  await p.say(String(LANGUAGE_CODES.indexOf(lang) + 1));
  if (optIn) {
    await p.say("6");
    await p.say("1");
  }
  return p;
}

async function adminClient(e: E2E) {
  const a = await createVolunteer(e.deps, { role: "admin", name: "Admin" });
  const { client } = makeClient(e.deps);
  await client.auth.login({ email: a.email, password: a.password });
  return { client, admin: a };
}

describe("announcements opt-in (WhatsApp)", () => {
  it("menu 6 asks first; yes / no are remembered; STOP stops; the menu shows the current choice", async () => {
    t = await makeE2E();
    const p = await person(t, "33640000001", "en", false);
    const bid = await beneficiaryIdOf(t, "33640000001");
    await p.say("6");
    expect((await p.out()).at(-1)).toBe(waText("en", "announcements_ask", { name: t.config.ASSOCIATION_NAME }));
    await p.say("1");
    expect((await p.out()).at(-2)).toBe(waText("en", "announcements_on"));
    const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b!.announcementsOptInAt).not.toBeNull();

    await p.say("6");
    expect(await p.last()).toBe(waText("en", "announcements_ask_on", { name: t.config.ASSOCIATION_NAME }));
    await p.say("4"); // anything else: back to the normal flow, nothing changed
    expect(await p.last()).toBe(waText("en", "chat_intro"));

    await p.say("STOP");
    expect(await p.last()).toBe(waText("en", "announcements_off"));
    const [b2] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b2!.announcementsOptInAt).toBeNull();
  });

  it("'delete my data' also withdraws the consent", async () => {
    t = await makeE2E();
    const p = await person(t, "33640000002", "fr", true);
    await p.say("9");
    await p.say("1");
    const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, await beneficiaryIdOf(t, "33640000002")));
    expect(b!.announcementsOptInAt).toBeNull();
  });
});

describe("announcements (sandbox, 24 h window always open)", () => {
  it("draft → estimate → approved by someone else → each opted-in person gets it in their language, once", async () => {
    t = await makeE2E();
    const en = await person(t, "33640000010", "en", true);
    const ar = await person(t, "33640000011", "ar", true);
    const no = await person(t, "33640000012", "fr", false);
    const before = (await no.out()).length;

    const draft = await t.client.broadcasts.create({ textFr: TEXT, languages: null });
    expect(draft).toMatchObject({ status: "draft", createdByName: "Test Volunteer" });
    expect(draft.estimate).toMatchObject({ recipients: 2, inWindow: 2, outsideWindow: 0, whatsappCostCents: 0, translations: 2 });
    expect(draft.estimate.byLanguage.map((l) => l.language).sort()).toEqual(["ar", "en"]);
    expect((await t.client.broadcasts.estimate({ languages: ["ar"] })).recipients).toBe(1);

    // the volunteer who wrote it cannot send it (no broadcasts.approve)
    expect(await code(t.client.broadcasts.approve({ id: draft.id }))).toBe("FORBIDDEN");
    const preview = await t.client.broadcasts.preview({ id: draft.id, language: "fr" });
    expect(preview.text).toBe(`📣 *${t.config.ASSOCIATION_NAME}*\n${TEXT}\n\n${waText("fr", "broadcast_stop_hint")}\n\n${waText("fr", "footer", { name: t.config.ASSOCIATION_NAME, contact: t.config.ASSOCIATION_CONTACT })}`);

    const { client: admin } = await adminClient(t);
    const sent = await admin.broadcasts.approve({ id: draft.id });
    expect(sent).toMatchObject({ status: "sending", approvedByName: "Admin" });
    await t.queue.drain();

    const enLast = await en.last();
    expect(enLast.startsWith(`📣 *${t.config.ASSOCIATION_NAME}*\n[en] ${TEXT}`)).toBe(true);
    expect(enLast).toContain(waText("en", "broadcast_stop_hint"));
    expect(enLast).toContain(t.config.ASSOCIATION_CONTACT);
    const plain = (x: string) => x.replace(/[⁦-⁩‏]/g, "");
    expect(plain(await ar.last())).toContain(`[ar] ${TEXT}`);
    expect(await ar.last()).toContain(waText("ar", "broadcast_stop_hint"));
    expect((await no.out()).length).toBe(before);

    const [after] = await t.client.broadcasts.list();
    expect(after).toMatchObject({ status: "sent", stats: { total: 2, sent: 2, awaitingReply: 0, failed: 0, skipped: 0 } });
    expect(await code(admin.broadcasts.approve({ id: draft.id }))).toBe("CONFLICT:not_draft");
    expect(await code(t.client.broadcasts.update({ id: draft.id, broadcast: { textFr: "abc", languages: null } }))).toBe("BAD_REQUEST"); // too short
    expect(await code(t.client.broadcasts.update({ id: draft.id, broadcast: { textFr: "Un autre texte", languages: null } }))).toBe("CONFLICT:not_draft");

    // a re-run of the dispatch job or of a send job does not send twice
    await getBroadcasts(t.wdeps).dispatch(draft.id);
    await t.wdeps.jobs.send("wa.send", { kind: "broadcast", broadcastId: draft.id, beneficiaryId: await beneficiaryIdOf(t, "33640000010") });
    await t.queue.drain();
    expect((await en.out()).filter((m) => m.includes(TEXT))).toHaveLength(1);

    const logged = (await t.deps.db.select().from(accessLog).where(eq(accessLog.targetId, draft.id))).map((l) => l.action).sort();
    expect(logged).toEqual(["broadcasts.approve", "broadcasts.create"]);
  });

  it("language filter: only the chosen languages", async () => {
    t = await makeE2E();
    const en = await person(t, "33640000020", "en", true);
    const fr = await person(t, "33640000021", "fr", true);
    const { client: admin } = await adminClient(t);
    const d = await t.client.broadcasts.create({ textFr: TEXT, languages: ["fr"] });
    await admin.broadcasts.approve({ id: d.id });
    await t.queue.drain();
    expect(await fr.last()).toContain(TEXT);
    expect(await en.last()).not.toContain(TEXT);
  });

  it("four-eyes: an admin cannot approve their own announcement unless BROADCAST_FOUR_EYES=off", async () => {
    t = await makeE2E();
    await person(t, "33640000030", "fr", true);
    const { client: admin } = await adminClient(t);
    const own = await admin.broadcasts.create({ textFr: TEXT, languages: null });
    expect(await code(admin.broadcasts.approve({ id: own.id }))).toBe("CONFLICT:own_broadcast");
    await t.close();

    t = await makeE2E({ config: { BROADCAST_FOUR_EYES: "off" } });
    await person(t, "33640000030", "fr", true);
    const { client: solo } = await adminClient(t);
    const mine = await solo.broadcasts.create({ textFr: TEXT, languages: null });
    expect(await code(solo.broadcasts.approve({ id: mine.id }))).toBe("ok");
  });

  it("no one opted in: nothing to approve", async () => {
    t = await makeE2E();
    await person(t, "33640000040", "fr", false);
    const { client: admin } = await adminClient(t);
    const d = await t.client.broadcasts.create({ textFr: TEXT, languages: null });
    expect(await code(admin.broadcasts.approve({ id: d.id }))).toBe("CONFLICT:no_recipients");
  });

  it("drafts: the author edits or cancels; another volunteer cannot; an approver can; cancelled ones are never sent", async () => {
    t = await makeE2E();
    await person(t, "33640000050", "fr", true);
    const d = await t.client.broadcasts.create({ textFr: TEXT, languages: null });
    const other = await createVolunteer(t.deps, { name: "Autre" });
    const { client: otherClient } = makeClient(t.deps);
    await otherClient.auth.login({ email: other.email, password: other.password });
    expect(await code(otherClient.broadcasts.update({ id: d.id, broadcast: { textFr: "Texte changé par un autre", languages: null } }))).toBe("FORBIDDEN");
    expect(await code(otherClient.broadcasts.cancel({ id: d.id }))).toBe("FORBIDDEN");
    expect(await code(t.client.broadcasts.update({ id: d.id, broadcast: { textFr: "Texte corrigé par l'auteur", languages: null } }))).toBe("ok");

    const { client: admin } = await adminClient(t);
    expect(await code(admin.broadcasts.update({ id: d.id, broadcast: { textFr: "Texte corrigé par l'admin", languages: null } }))).toBe("ok");
    expect((await admin.broadcasts.cancel({ id: d.id })).status).toBe("cancelled");
    expect(await code(admin.broadcasts.approve({ id: d.id }))).toBe("CONFLICT:not_draft");
    expect(await code(t.client.broadcasts.cancel({ id: randomUUID() }))).toBe("NOT_FOUND");
  });

  it("responders see nothing of announcements", async () => {
    t = await makeE2E();
    const r = await createVolunteer(t.deps);
    const { client } = makeClient(t.deps);
    await client.auth.login({ email: r.email, password: r.password });
    const { client: admin } = await adminClient(t);
    await admin.volunteers.setRole({ id: r.id, role: "responder" });
    expect(await code(client.broadcasts.list())).toBe("FORBIDDEN");
    expect(await code(client.broadcasts.create({ textFr: TEXT, languages: null }))).toBe("FORBIDDEN");
    expect(await code(client.broadcasts.cancel({ id: randomUUID() }))).toBe("FORBIDDEN");
  });
});

describe("announcements outside the 24 h window (meta mode)", () => {
  async function setup() {
    w = await makeWa({ meta: true, now: "2026-11-06T09:00:00Z" });
    w.tllm.nextLanguage = { language: "en", confidence: 0.95 };
    const p = "33641000001";
    await w.say(p, "Hello, I need help");
    await w.say(p, "6");
    await w.say(p, "1");
    const { beneficiary } = await w.services.beneficiaries.findOrCreateByWaId(p);
    const author = await createVolunteer(w.deps, { name: "Auteur" });
    const svc = getBroadcasts(w.wdeps);
    w.clock.set("2026-11-07T15:00:00Z"); // 30 h later: the window is closed
    const d = await svc.create({ textFr: TEXT, languages: null }, author.id);
    return { p, bid: beneficiary.id, svc, d };
  }
  const button = (from: string, text: string) => ({ id: `wamid.${randomUUID()}`, from, timestamp: "1", type: "button" as const, button: { text } });

  it("sends the paid template first, then the text when the person taps Read (once)", async () => {
    const { p, bid, svc, d } = await setup();
    expect(d.estimate).toMatchObject({ recipients: 1, inWindow: 0, outsideWindow: 1, whatsappCostCents: 8.59 });
    const textsBefore = w!.meta!.texts.length;
    await svc.approve(d.id, w!.volunteerId);
    await w!.drain();
    expect(w!.meta!.templates).toEqual([{ to: p, template: "announcement", params: [] }]);
    expect(w!.meta!.texts).toHaveLength(textsBefore);
    const [r] = await w!.deps.db.select().from(broadcastRecipients).where(eq(broadcastRecipients.beneficiaryId, bid));
    expect(r).toMatchObject({ status: "awaiting_reply", viaTemplate: true });
    expect((await svc.get(d.id)).estimate.whatsappCostCents).toBe(8.59); // the estimate taken at approval

    await processInbound(w!.wdeps, button(p, "Read"));
    await w!.drain();
    const menusBefore = w!.meta!.interactives.length;
    const got = w!.meta!.texts.filter((m) => m.body.includes(TEXT));
    expect(got).toHaveLength(1);
    expect(w!.meta!.texts.at(-1)!.body).toContain(TEXT); // the text, and no main menu after it
    expect(w!.meta!.interactives.length).toBe(menusBefore);
    await w!.say(p, "thanks");
    expect(w!.meta!.texts.filter((m) => m.body.includes(TEXT))).toHaveLength(1);
    expect((await svc.get(d.id)).stats).toMatchObject({ total: 1, sent: 1, awaitingReply: 0 });
  });

  it("Stop on the template opts out and drops the waiting text", async () => {
    const { p, bid, svc, d } = await setup();
    await svc.approve(d.id, w!.volunteerId);
    await w!.drain();
    await processInbound(w!.wdeps, button(p, "Stop"));
    await w!.drain();
    expect(w!.meta!.texts.filter((m) => m.body.includes(TEXT))).toHaveLength(0);
    expect(w!.meta!.texts.at(-1)!.body).toBe(waText("en", "announcements_off"));
    const [b] = await w!.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b!.announcementsOptInAt).toBeNull();
    const [r] = await w!.deps.db.select().from(broadcastRecipients).where(and(eq(broadcastRecipients.beneficiaryId, bid), eq(broadcastRecipients.broadcastId, d.id)));
    expect(r!.status).toBe("skipped");
  });
});
