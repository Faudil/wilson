import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { RECOVERY_WORDS, RECOVERY_WORD_COUNT } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { beneficiaries, beneficiarySessions, messages } from "../src/db/schema.js";
import { processWebhookPayload } from "../src/whatsapp/webhook.js";
import { makeE2E, sampleFile, type E2E } from "./e2e.helpers.js";
import { createVolunteer, makeClient } from "./helpers.js";

let t: E2E;
beforeAll(async () => {
  t = await makeE2E({ config: { WEB_LOGIN_FAILURES_PER_IP: "3", WEB_SIGNUP_PER_IP_PER_HOUR: "4" } });
});
afterAll(() => t.close());

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string; message?: string }) => e.code ?? "error");
let ipSeq = 0;
/** A browser of its own (cookie jar + IP): the person's phone. */
const browser = (ip = `10.0.0.${++ipSeq}`) => makeClient(t.deps, { ip });

async function signup(name = "Amina", language: "fr" | "ar" | "bn" = "ar") {
  const b = browser();
  const r = await b.client.me.signup({ name, language, accepted: true, sharedDevice: false });
  await t.queue.drain();
  return { ...b, ...r };
}
const idOf = async (handle: string) =>
  (await t.deps.db.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.webHandle, handle)))[0]!.id;

describe("web accounts: sign-up and sign-in without a phone number", () => {
  it("sign-up gives an account number, recovery words from the list and a session; the thread opens on welcome + menu", async () => {
    const s = await signup();
    expect(s.me).toMatchObject({ name: "Amina", language: "ar", sharedDevice: false });
    expect(s.me.handle).toMatch(/^W-[A-Z0-9]{6}$/);
    expect(s.words).toHaveLength(RECOVERY_WORD_COUNT);
    for (const w of s.words) expect(RECOVERY_WORDS.some(([x]) => x === w)).toBe(true);
    expect(s.jar.me).toBeTruthy();
    expect(await s.client.me.get()).toEqual(s.me);

    const thread = await s.client.me.thread();
    expect(thread[0]!.text).toBe(waText("ar", "welcome"));
    expect(thread[1]!.choices.length).toBeGreaterThan(3); // the main menu as buttons
    // Nothing in clear: the name is encrypted, the words are only an HMAC.
    const [row] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.webHandle, s.me.handle));
    expect(row!.webNameEnc!.toString("utf8")).not.toContain("Amina");
    expect(row!.webWordsHash).not.toContain(s.words[0]!);
    expect(row!.waIdLast2).toBe("");
  });

  it("a question typed on the page gets the bot's answer in the same thread; volunteers see the account number", async () => {
    const s = await signup("Rahim", "bn");
    await s.client.me.send({ text: "Comment avoir une domiciliation ?" });
    await t.queue.drain();
    const thread = await s.client.me.thread();
    expect(thread.some((m) => m.direction === "inbound" && m.text === "Comment avoir une domiciliation ?")).toBe(true);
    expect(thread.filter((m) => m.direction === "outbound").length).toBeGreaterThan(2);

    const id = await idOf(s.me.handle);
    const list = await t.client.beneficiaries.list({ limit: 10, search: s.me.handle.toLowerCase() });
    expect(list.items.map((i) => i.id)).toEqual([id]);
    expect(list.items[0]).toMatchObject({ label: s.me.handle, webAccount: { handle: s.me.handle, name: null, lockedAt: null } });
    expect((await t.client.beneficiaries.get({ id })).webAccount?.name).toBe("Rahim");
  });

  it("letter photo from the page -> review queue -> approved explanation arrives on the page; the upload itself is not kept", async () => {
    const s = await signup("Yonas", "fr");
    await s.client.me.send({ file: sampleFile("letters", "05-caf-demande-pieces.png") });
    await t.queue.drain();
    const id = await idOf(s.me.handle);
    const page = await t.client.letters.list({ limit: 50, status: ["pending_review"] });
    const item = page.items.find((l) => l.beneficiaryId === id)!;
    expect(item.beneficiaryLabel).toBe(s.me.handle);
    const text = (await t.client.letters.get({ id: item.id })).outgoingText!;
    await t.client.letters.approve({ id: item.id });
    await t.queue.drain();
    const outs = (await s.client.me.thread()).filter((m) => m.direction === "outbound").map((m) => m.text);
    expect(outs).toContain(text);
    expect([...t.blobs.objects.keys()].some((k) => k.startsWith(`web/${id}/`))).toBe(false);
  });

  it("documents: a document sent from the page is analysed, confirmed with the menu and listed", async () => {
    const s = await signup("Sara", "fr");
    await s.client.me.send({ file: sampleFile("documents", "d1-recepisse.png"), fileKind: "document" });
    await t.queue.drain();
    await s.client.me.send({ text: "1" }); // "correct"
    await t.queue.drain();
    const docs = await s.client.me.documents();
    expect(docs).toHaveLength(1);
  });

  it("sign-in with the words (any case, accents), a wrong set is refused, and too many wrong sets block the IP", async () => {
    const s = await signup("Omar");
    const b = browser();
    const me = await b.client.me.login({ words: s.words.map((w) => w.toUpperCase()), sharedDevice: true });
    expect(me).toMatchObject({ handle: s.me.handle, sharedDevice: true });
    const [sess] = await t.deps.db.select().from(beneficiarySessions).where(eq(beneficiarySessions.sharedDevice, true));
    expect(sess!.expiresAt.getTime() - t.clock.now().getTime()).toBe(3600_000);

    const wrong = [...s.words].reverse().map((w, i) => (i === 0 ? (w === "chat" ? "chien" : "chat") : w));
    const guesser = browser();
    for (let i = 0; i < 3; i++) expect(await code(guesser.client.me.login({ words: wrong, sharedDevice: false }))).toBe("UNAUTHORIZED");
    expect(await code(guesser.client.me.login({ words: s.words, sharedDevice: false }))).toBe("TOO_MANY_REQUESTS");
    expect(await code(guesser.client.me.login({ words: ["xyz", "a", "b", "c", "d", "e"], sharedDevice: false }))).toBe("BAD_REQUEST");
  });

  it("only the person's own session reaches their data; a volunteer cookie is not a web session", async () => {
    expect(await code(t.client.me.thread())).toBe("UNAUTHORIZED");
    expect(await code(browser().client.me.get())).toBe("UNAUTHORIZED");
    // The WhatsApp webhook cannot speak for a web account.
    const s = await signup("Lina");
    const id = await idOf(s.me.handle);
    const before = (await t.deps.db.select().from(messages).where(eq(messages.beneficiaryId, id))).length;
    await processWebhookPayload(t.wdeps, { object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "sandbox" },
      messages: [{ id: "fake.1", from: `web:${id}`, timestamp: "1", type: "text", text: { body: "9" } }],
    } }] }] } as never);
    expect((await t.deps.db.select().from(messages).where(eq(messages.beneficiaryId, id))).length).toBe(before);
  });

  it("honeypot and per-IP sign-up limit", async () => {
    const b = browser();
    expect(await code(b.client.me.signup({ name: "x", language: "fr", accepted: true, sharedDevice: false, website: "" }))).toBe("ok");
    expect(await code(b.client.me.signup({ name: "bot", language: "fr", accepted: true, sharedDevice: false, website: "http://spam" }))).toBe("BAD_REQUEST");
    for (let i = 0; i < 3; i++) await b.client.me.signup({ name: `n${i}`, language: "fr", accepted: true, sharedDevice: false });
    expect(await code(b.client.me.signup({ name: "n5", language: "fr", accepted: true, sharedDevice: false }))).toBe("TOO_MANY_REQUESTS");
  });
});

describe("web accounts: a volunteer recovers or locks a lost account", () => {
  it("unlock code: old words and sessions stop at once, the code gives new words once, it cannot be reused", async () => {
    const s = await signup("Hawa");
    const id = await idOf(s.me.handle);
    // Needs beneficiaries.recover (admins get it with 2FA; plain volunteers too in the POC bundle).
    const issued = await t.client.beneficiaries.unlockCode({ id });
    expect(issued.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect((await t.client.beneficiaries.get({ id })).webAccount?.unlockCodeUntil).toBe(issued.expiresAt);
    expect(await code(s.client.me.get())).toBe("UNAUTHORIZED"); // signed out
    expect(await code(browser().client.me.login({ words: s.words, sharedDevice: false }))).toBe("UNAUTHORIZED");

    const b = browser();
    const r = await b.client.me.redeem({ code: issued.code.toLowerCase().replace("-", " "), sharedDevice: false });
    expect(r.me.handle).toBe(s.me.handle);
    expect(r.words).not.toEqual(s.words);
    expect(await code(browser().client.me.redeem({ code: issued.code, sharedDevice: false }))).toBe("UNAUTHORIZED");
    expect((await browser().client.me.login({ words: r.words, sharedDevice: false })).handle).toBe(s.me.handle);
  });

  it("an unlock code expires after 24 hours", async () => {
    const s = await signup("Ali");
    const issued = await t.client.beneficiaries.unlockCode({ id: await idOf(s.me.handle) });
    const saved = t.clock.current;
    t.clock.current = new Date(saved.getTime() + 24 * 3600_000 + 1000);
    expect(await code(browser().client.me.redeem({ code: issued.code, sharedDevice: false }))).toBe("UNAUTHORIZED");
    t.clock.current = saved;
  });

  it("lock: signed out everywhere, the words are refused (FORBIDDEN), unlock or an unlock code opens it again", async () => {
    const s = await signup("Moussa");
    const id = await idOf(s.me.handle);
    const locked = await t.client.beneficiaries.lock({ id });
    expect(locked.webAccount?.lockedAt).toBeTruthy();
    expect(await code(s.client.me.get())).toBe("UNAUTHORIZED");
    expect(await code(browser().client.me.login({ words: s.words, sharedDevice: false }))).toBe("FORBIDDEN");
    await t.client.beneficiaries.unlock({ id });
    expect((await browser().client.me.login({ words: s.words, sharedDevice: false })).handle).toBe(s.me.handle);

    await t.client.beneficiaries.lock({ id });
    const issued = await t.client.beneficiaries.unlockCode({ id });
    const r = await browser().client.me.redeem({ code: issued.code, sharedDevice: false });
    expect((await t.client.beneficiaries.get({ id })).webAccount?.lockedAt).toBeNull();
    expect(r.words).toHaveLength(RECOVERY_WORD_COUNT);
  });

  it("WhatsApp people have no web account: NOT_FOUND; a responder (no beneficiaries.recover) is FORBIDDEN", async () => {
    const p = t.phone("33612009999");
    await p.say("bonjour");
    const [wa] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, t.deps.crypto.lookupHash("33612009999")));
    expect(await code(t.client.beneficiaries.unlockCode({ id: wa!.id }))).toBe("NOT_FOUND");
    expect(await code(t.client.beneficiaries.lock({ id: wa!.id }))).toBe("NOT_FOUND");

    const v = await createVolunteer(t.deps);
    await t.deps.db.execute(`update volunteers set role = 'responder' where id = '${v.id}'` as never);
    const r = makeClient(t.deps);
    await r.client.auth.login({ email: v.email, password: v.password });
    const s = await signup("Nour");
    expect(await code(r.client.beneficiaries.unlockCode({ id: await idOf(s.me.handle) }))).toBe("FORBIDDEN");
  });

  it("delete all my data from the page: archived, signed out, the words no longer work", async () => {
    const s = await signup("Ibrahim");
    await s.client.me.deleteAll();
    expect(s.jar.me).toBeNull();
    expect(await code(browser().client.me.login({ words: s.words, sharedDevice: false }))).toBe("UNAUTHORIZED");
    const [row] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.webHandle, s.me.handle));
    expect(row!.archivedAt).not.toBeNull();
  });
});
