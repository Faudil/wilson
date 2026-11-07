import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { accessLog, beneficiaries, volunteers } from "../src/db/schema.js";
import { isoWeekday, openOn } from "../src/places/service.js";
import { createVolunteer, makeClient } from "./helpers.js";
import { beneficiaryIdOf, makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");
// 2026-11-06 is a Friday (ISO weekday 5).
const TODAY = "2026-11-06";

async function setup(lang: "en" | "ar" | "fr" = "en", phone = "33630000001") {
  t = await makeE2E({ now: `${TODAY}T15:00:00Z`, config: { CHAT_MODE: "review" } });
  const p = t.phone(phone);
  await p.say("?");
  await p.say(String(LANGUAGE_CODES.indexOf(lang) + 1));
  return { p, bid: await beneficiaryIdOf(t, phone) };
}

const shelter = { kind: "shelter" as const, name: "Halte de nuit Saint-Martin", address: "12 rue du Faubourg, 75010 Paris", phone: "01 40 00 00 00", details: "Femmes et familles en priorité. Arriver avant 20h.", startsOn: TODAY, opensAt: "19:00", closesAt: "08:00" };
const food = { kind: "food" as const, name: "Distribution de repas", address: "Place de la République", startsOn: "2026-11-01", endsOn: "2026-11-30", weekdays: [5], opensAt: "12:00", closesAt: "14:00" };

describe("places: dates and weekdays", () => {
  it("is open between the dates, on the chosen weekdays only", () => {
    expect(isoWeekday("2026-11-06")).toBe(5);
    expect(isoWeekday("2026-11-08")).toBe(7);
    const p = { startsOn: "2026-11-01", endsOn: "2026-11-30", weekdays: [5], removedAt: null };
    expect(openOn(p, "2026-11-06")).toBe(true);
    expect(openOn(p, "2026-11-07")).toBe(false); // Saturday
    expect(openOn(p, "2026-12-04")).toBe(false); // after the end
    expect(openOn({ ...p, weekdays: [], endsOn: null }, "2027-05-01")).toBe(true);
    expect(openOn({ ...p, removedAt: new Date() }, "2026-11-06")).toBe(false);
  });
});

describe("places in WhatsApp", () => {
  it("menu 5 lists today's places, translated once and cached, with the 115 line and the footer", async () => {
    const { p } = await setup("en");
    await t!.client.places.create(shelter);
    await t!.client.places.create(food);
    await t!.client.places.create({ ...food, name: "Petit-déjeuner du samedi", weekdays: [6] }); // not today

    await p.say("5");
    const msg = plain(await p.last());
    expect(msg.startsWith(plain(waText("en", "places_title", { date: "x" })).split("x")[0]!)).toBe(true);
    expect(msg).toContain("🛏️ *[en] Halte de nuit Saint-Martin*");
    expect(msg).toContain("🕘 19:00–08:00");
    expect(msg).toContain("📍 12 rue du Faubourg, 75010 Paris");
    expect(msg).toContain("📞 01 40 00 00 00");
    expect(msg).toContain("[en] Femmes et familles en priorité.");
    expect(msg).toContain("🍽️ *[en] Distribution de repas*");
    expect(msg).not.toContain("Petit-déjeuner");
    // shelter listed before food, the 115 line last before the footer
    expect(msg.indexOf("🛏️")).toBeLessThan(msg.indexOf("🍽️"));
    expect(msg).toContain(plain(waText("en", "places_115")));
    expect(msg.endsWith(plain(waText("en", "footer", { name: t!.config.ASSOCIATION_NAME, contact: t!.config.ASSOCIATION_CONTACT })))).toBe(true);

    // cached: the second request does not translate again
    const translateSpy = t!.fake.translateText.bind(t!.fake);
    let calls = 0;
    t!.fake.translateText = async (i) => (calls++, translateSpy(i));
    await p.say("5");
    expect(calls).toBe(0);

    // an edit clears the cache
    const [first] = await t!.client.places.list({ scope: "today" });
    await t!.client.places.update({ id: first!.id, place: { ...shelter, name: "Halte de nuit (nouvelle adresse)" } });
    await p.say("5");
    expect(calls).toBeGreaterThan(0);
    expect(plain(await p.last())).toContain("[en] Halte de nuit (nouvelle adresse)");
  });

  it("menu 5 with nothing posted says so and gives the 115", async () => {
    const { p } = await setup("fr");
    await p.say("5");
    const msg = await p.last();
    expect(msg).toContain(waText("fr", "places_none"));
    expect(msg).toContain(waText("fr", "places_115"));
  });

  it("Arabic: addresses, phones and hours are isolated inside the right-to-left text", async () => {
    const { p } = await setup("ar", "33630000002");
    await t!.client.places.create(shelter);
    await p.say("5");
    const msg = await p.last();
    expect(msg).toContain("📍 ⁨12 rue du Faubourg, 75010 Paris⁩");
    expect(msg).toContain("🕘 ⁨19:00–08:00⁩");
  });

  it("'where can I eat tonight?' gets today's places at once, without a review draft", async () => {
    const { p, bid } = await setup("en");
    await t!.client.places.create(food);
    await p.say("Where can I eat tonight?");
    expect(plain(await p.last())).toContain("[en] Distribution de repas");
    const conv = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(conv.pendingDrafts).toBe(0);
    const sent = conv.messages.filter((m) => m.intent === "places");
    expect(sent.at(-1)!.state).toBe("sent");
    expect(sent.at(-1)!.textFr).toContain("Distribution de repas"); // French version for volunteers
  });

  it("'I sleep outside tonight' gets the emergency numbers, then the places, and is flagged for a volunteer", async () => {
    const { p, bid } = await setup("fr");
    await t!.client.places.create(shelter);
    await p.say("Je vais dormir dehors ce soir");
    const out = await p.out();
    expect(out.at(-2)).toContain("115 - hébergement d'urgence");
    expect(out.at(-1)).toContain("Halte de nuit Saint-Martin");
    const [b] = await t!.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b!.chatStatus).toBe("needs_human");
  });

  it("nothing posted: the question goes to the knowledge base like any other (draft for review)", async () => {
    const { p, bid } = await setup("en");
    await p.say("Where can I eat tonight?");
    expect(await p.last()).toContain(waText("en", "chat_pending"));
    const conv = await t!.client.conversations.get({ beneficiaryId: bid });
    expect(conv.messages.find((m) => m.state === "draft")!.intent).toBe("places");
  });

  it("removed places disappear at once; past ones leave the upcoming list", async () => {
    const { p } = await setup("fr");
    const a = await t!.client.places.create(shelter);
    await t!.client.places.create({ ...food, startsOn: "2026-10-01", endsOn: "2026-10-31" });
    expect((await t!.client.places.list({ scope: "upcoming" })).map((x) => x.name)).toEqual([shelter.name]);
    expect(await t!.client.places.list({ scope: "all" })).toHaveLength(2);
    await t!.client.places.remove({ id: a.id });
    await p.say("5");
    expect(await p.last()).toContain(waText("fr", "places_none"));
    expect(await code(t!.client.places.remove({ id: a.id }))).toBe("NOT_FOUND");
  });

  it("rejects an end date before the start date", async () => {
    await setup("fr");
    expect(await code(t!.client.places.create({ ...food, startsOn: "2026-11-10", endsOn: "2026-11-01" }))).toBe("BAD_REQUEST");
  });
});

describe("places permissions", () => {
  it("responders see places but cannot post; volunteers post; every change is logged", async () => {
    await setup("fr");
    const r = await createVolunteer(t!.deps);
    await t!.deps.db.update(volunteers).set({ role: "responder" }).where(eq(volunteers.id, r.id));
    const { client: responder } = makeClient(t!.deps);
    await responder.auth.login({ email: r.email, password: r.password });
    expect(await code(responder.places.list({ scope: "today" }))).toBe("ok");
    expect(await code(responder.places.preview({ language: "en" }))).toBe("ok");
    expect(await code(responder.places.create(shelter))).toBe("FORBIDDEN");

    const created = await t!.client.places.create(shelter);
    expect(await code(responder.places.update({ id: created.id, place: shelter }))).toBe("FORBIDDEN");
    expect(await code(responder.places.remove({ id: created.id }))).toBe("FORBIDDEN");
    await t!.client.places.update({ id: created.id, place: shelter });
    await t!.client.places.remove({ id: created.id });
    const actions = (await t!.deps.db.select().from(accessLog).where(eq(accessLog.targetId, created.id))).map((l) => l.action);
    expect(actions).toEqual(["places.create", "places.update", "places.remove"]);
  });
});
