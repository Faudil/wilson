import { afterEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { beneficiaries, messages } from "../src/db/schema.js";
import { OsmGeoProvider, TtlCache, overpassQuery, parseOverpass, parseSoliguide, soliguideKind } from "../src/geo/osm.js";
import { NoGeo, directionsUrl, distanceM, formatDistance, type NearbyPoi } from "../src/geo/provider.js";
import { looksLikeAddress } from "../src/nearby/service.js";
import { testConfig } from "./helpers.js";
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

const plain = (s: string) => s.replace(/[⁦-⁩‏]/g, "");
const TODAY = "2026-11-06"; // a Friday
/** The person, Place de la République (Paris). */
const ME = { lat: 48.8674, lon: 2.3636 };
const SHELTER = { lat: 48.87, lon: 2.36 }; // ~400 m
const shelter = { kind: "shelter" as const, name: "Halte de nuit Saint-Martin", address: "12 rue du Faubourg, 75010 Paris", startsOn: TODAY, opensAt: "19:00", closesAt: "08:00" };

const poi = (p: Partial<NearbyPoi> & Pick<NearbyPoi, "kind" | "lat" | "lon">): NearbyPoi => ({ source: "osm", name: null, ...p });
const OSM: NearbyPoi[] = [
  poi({ kind: "water", lat: 48.8676, lon: 2.3638 }), // ~25 m, no name
  poi({ kind: "water", lat: 48.869, lon: 2.366 }), // farther: only the nearest is shown
  poi({ kind: "transport", name: "République", lat: 48.8672, lon: 2.3634 }),
  poi({ kind: "pharmacy", name: "Pharmacie du Temple", address: "3 rue du Temple", lat: 48.866, lon: 2.362 }),
  poi({ kind: "toilets", lat: 48.885, lon: 2.37 }), // ~2 km: outside the 1.5 km radius
];
const SOLI: NearbyPoi[] = [
  { source: "soliguide", kind: "food", name: "Restos du Cœur République", lat: 48.868, lon: 2.365, address: "5 rue Léon Jouhaux", hoursToday: "12:00–14:00", url: "https://soliguide.fr/fr/fiche/restos-republique" },
  // Same spot as the volunteers' shelter: not listed twice.
  { source: "soliguide", kind: "shelter", name: "Halte Saint-Martin (Soliguide)", lat: 48.87001, lon: 2.36001 },
];

describe("geo helpers", () => {
  it("distances, formatting and directions links carry no origin", () => {
    expect(Math.round(distanceM(ME, SHELTER))).toBeGreaterThan(350);
    expect(Math.round(distanceM(ME, SHELTER))).toBeLessThan(450);
    expect(formatDistance(23)).toBe("20 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(directionsUrl(SHELTER)).toBe("https://www.google.com/maps/dir/?api=1&destination=48.87000,2.36000&travelmode=walking");
  });

  it("typed text that looks like an address, not a question", () => {
    expect(looksLikeAddress("12 rue du Faubourg Saint-Martin")).toBe(true);
    expect(looksLikeAddress("gare de l'Est")).toBe(true);
    expect(looksLikeAddress("où je peux manger ?")).toBe(false);
    expect(looksLikeAddress("je ne sais pas trop où je suis mais il y a un grand parc")).toBe(false);
  });

  it("parses OpenStreetMap elements into kinds, keeping nodes and way centres", () => {
    const pois = parseOverpass({ elements: [
      { type: "node", lat: 1, lon: 2, tags: { amenity: "drinking_water" } },
      { type: "way", center: { lat: 3, lon: 4 }, tags: { amenity: "toilets", name: "WC", opening_hours: "24/7" } },
      { type: "node", lat: 5, lon: 6, tags: { amenity: "social_facility", social_facility: "shelter", "social_facility:for": "homeless", "addr:housenumber": "8", "addr:street": "rue X" } },
      { type: "node", lat: 7, lon: 8, tags: { social_facility: "soup_kitchen", amenity: "social_facility" } },
      { type: "node", lat: 9, lon: 10, tags: { highway: "bus_stop", name: "Arrêt" } },
      { type: "node", lat: 9, lon: 10, tags: { shop: "bakery" } }, // not asked for
      { type: "relation", tags: { amenity: "pharmacy" } }, // no position
    ] });
    expect(pois.map((p) => p.kind)).toEqual(["water", "toilets", "shelter", "food", "transport"]);
    expect(pois[1]).toMatchObject({ lat: 3, lon: 4, name: "WC", hoursToday: "24/7" });
    expect(pois[2]!.address).toBe("8 rue X");
    expect(overpassQuery(ME, 1000)).toContain(`(around:1000,${ME.lat},${ME.lon})`);
    expect(overpassQuery(ME, 1000)).toContain(`["access"!~"^(private|customers|no|permissive_customers)$"]`);
  });

  it("parses Soliguide places: today's hours, closed today left out, categories to kinds", () => {
    const day = (open: boolean, slots: [number, number][] = []) => ({ open, timeslot: slots.map(([start, end]) => ({ start, end })) });
    const pois = parseSoliguide({ places: [
      { lieu_id: 1, seo_url: "a", name: "Open", position: { adresse: "1 rue A", location: { coordinates: [2.36, 48.87] } }, services_all: [{ category: "food_distribution" }], newhours: { friday: day(true, [[900, 1230], [1400, 1700]]) }, entity: { phones: [{ phoneNumber: "01 02 03 04 05" }] } },
      { lieu_id: 2, name: "Closed today", position: { location: { coordinates: [2.36, 48.87] } }, newhours: { friday: day(false) } },
      { lieu_id: 3, name: "No hours", position: { location: { coordinates: [2.36, 48.87] } }, services_all: [{ category: 401 }] },
      { lieu_id: 4, name: "No position" },
    ] }, 5);
    expect(pois.map((p) => p.name)).toEqual(["Open", "No hours"]);
    expect(pois[0]).toMatchObject({ kind: "food", lat: 48.87, lon: 2.36, address: "1 rue A", phone: "01 02 03 04 05", hoursToday: "09:00–12:30, 14:00–17:00", url: "https://soliguide.fr/fr/fiche/a" });
    expect(pois[1]).toMatchObject({ kind: "shower", hoursToday: null, url: "https://soliguide.fr/fr/fiche/3" });
    expect(soliguideKind(["emergency_accommodation", "food"])).toBe("shelter");
    expect(soliguideKind(["clothing"])).toBe("clothes");
    expect(soliguideKind(["general_practitioner_health"])).toBe("health");
    expect(soliguideKind(["day_hosting"])).toBe("other");
  });

  it("the cache expires and drops its oldest entry when full", () => {
    let now = 0;
    const c = new TtlCache<number>(2, () => now);
    c.set("a", 1, 10);
    c.set("b", 2, 10);
    c.set("c", 3, 10);
    expect([c.get("a"), c.get("b"), c.get("c")]).toEqual([undefined, 2, 3]);
    now = 11;
    expect(c.get("b")).toBeUndefined();
  });
});

describe("OsmGeoProvider (usage policies, privacy, caching)", () => {
  type Call = { url: string; init: RequestInit };
  function provider(config: Record<string, string> = {}, answer: (url: string) => unknown = () => []) {
    const calls: Call[] = [];
    const doFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = answer(url);
      if (body instanceof Error) return new Response("boom", { status: 503 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const geo = new OsmGeoProvider(testConfig({ OSM_CONTACT_EMAIL: "tech@asso.example", ...config }), doFetch);
    return { geo, calls };
  }
  const headers = (c: Call) => c.init.headers as Record<string, string>;

  it("geocodes with Nominatim: only the typed text, in France, identified, cached", async () => {
    const { geo, calls } = provider({}, () => [{ lat: "48.87", lon: "2.36" }]);
    expect(await geo.geocode("  12 rue du Faubourg   Paris ")).toEqual({ lat: 48.87, lon: 2.36 });
    expect(await geo.geocode("12 rue du faubourg paris")).toEqual({ lat: 48.87, lon: 2.36 });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.host).toBe("nominatim.openstreetmap.org");
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: "12 rue du Faubourg Paris", format: "jsonv2", limit: "1", countrycodes: "fr", "accept-language": "fr", email: "tech@asso.example" });
    expect(headers(calls[0]!)["User-Agent"]).toContain("tech@asso.example");
    expect(await geo.geocode("ab")).toBeNull(); // too short: no request
    expect(calls).toHaveLength(1);
  });

  it("waits at least a second between two Nominatim requests", async () => {
    const { geo, calls } = provider({}, () => []);
    const started = Date.now();
    await Promise.all([geo.geocode("adresse un"), geo.geocode("adresse deux")]);
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  });

  it("asks Overpass once per ~1 km area, around the area's centre (never the exact point)", async () => {
    const { geo, calls } = provider({}, () => ({ elements: [{ type: "node", lat: 48.8676, lon: 2.3638, tags: { amenity: "drinking_water" } }] }));
    const a = await geo.osmAround(ME, 1500);
    const b = await geo.osmAround({ lat: 48.8681, lon: 2.3612 }, 1500); // a few hundred metres away, same area
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
    const query = new URLSearchParams(calls[0]!.init.body as string).get("data") ?? String(calls[0]!.init.body);
    expect(query).toContain("(around:2300,48.87,2.36)");
    expect(query).not.toContain("48.8674");
  });

  it("does not cache a failure", async () => {
    let fail = true;
    const { geo, calls } = provider({}, () => (fail ? new Error("down") : { elements: [] }));
    expect(await geo.osmAround(ME, 1500)).toEqual([]);
    fail = false;
    await geo.osmAround(ME, 1500);
    expect(calls).toHaveLength(2);
  });

  it("asks Soliguide only with a key, with the area's coordinates and nothing else", async () => {
    const none = provider();
    expect(await none.geo.soliguideAround(ME, 1500, 5)).toEqual([]);
    expect(none.calls).toHaveLength(0);

    const { geo, calls } = provider({ SOLIGUIDE_API_KEY: "secret-token" }, () => ({ places: [] }));
    await geo.soliguideAround(ME, 1500, 5);
    await geo.soliguideAround(ME, 1500, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.soliguide.fr/new-search");
    expect(headers(calls[0]!).Authorization).toBe("JWT secret-token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ location: { geoType: "position", coordinates: [2.36, 48.87], distance: 2.3 }, options: { limit: 50 } });
  });
});

async function setup(lang: "en" | "ar" = "en", phone = "33650000001") {
  t = await makeE2E({ now: `${TODAY}T15:00:00Z`, config: { CHAT_MODE: "review" } });
  t.geo.addresses.set(shelter.address.toLowerCase(), SHELTER);
  t.geo.osm = OSM;
  t.geo.soliguide = SOLI;
  const p = t.phone(phone);
  await p.say("?");
  await p.say(String(LANGUAGE_CODES.indexOf(lang) + 1));
  return { p, bid: await beneficiaryIdOf(t, phone) };
}

describe("nearby places in WhatsApp", () => {
  it("volunteers' places are found on the map when saved, and again only when the address changes", async () => {
    t = await makeE2E({ now: `${TODAY}T15:00:00Z` });
    t.geo.addresses.set(shelter.address.toLowerCase(), SHELTER);
    const a = await t.client.places.create(shelter);
    expect(a.located).toBe(true);
    const b = await t.client.places.create({ ...shelter, name: "Ailleurs", address: "Nulle part" });
    expect(b.located).toBe(false);
    const geocodes = () => t!.geo.calls.filter((c) => c.fn === "geocode").length;
    const before = geocodes();
    await t.client.places.update({ id: a.id, place: { ...shelter, name: "Halte (renommée)" } });
    expect(geocodes()).toBe(before);
    expect((await t.client.places.update({ id: a.id, place: { ...shelter, address: "Nulle part" } })).located).toBe(false);
    expect(await t.client.places.create({ ...shelter, address: null })).toMatchObject({ located: false });
  });

  it("menu 5 offers to share a location; the answer lists what is near, nearest first, with distances and directions", async () => {
    const { p } = await setup("en");
    await t!.client.places.create(shelter);
    await p.say("5");
    expect(plain(await p.last())).toContain(plain(waText("en", "nearby_hint")));

    await p.share(ME.lat, ME.lon);
    const msg = plain(await p.last());
    expect(msg.startsWith(plain(waText("en", "nearby_title", { distance: "1.5 km" })))).toBe(true);
    // 1. the volunteers' place, 2. Soliguide (the duplicate of the shelter is left out), 3. one of each basic (water, toilets, shower, pharmacy, stop)
    const order = ["[en] Halte de nuit Saint-Martin", "Restos du Cœur République", "Drinking water", "Pharmacie du Temple", "🚏 *République*"].map((s) => msg.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(msg).not.toContain("Halte Saint-Martin (Soliguide)");
    expect(msg).not.toContain(waText("en", "nearby_toilets")); // 2 km away
    expect(msg.match(/💧/g)).toHaveLength(1);
    expect(msg).toContain("🛏️ *[en] Halte de nuit Saint-Martin* · 390 m");
    expect(msg).toContain("🕘 19:00–08:00");
    expect(msg).toContain("🍽️ *Restos du Cœur République* · 120 m\n🕘 12:00–14:00\n📍 5 rue Léon Jouhaux");
    expect(msg).toContain(`🧭 ${directionsUrl(SHELTER)}`);
    expect(msg).toContain("ℹ️ https://soliguide.fr/fr/fiche/restos-republique");
    expect(msg).toContain(waText("en", "places_115"));
    expect(msg).toContain("© OpenStreetMap · Soliguide");
    expect(msg).toContain(waText("en", "footer", { name: t!.config.ASSOCIATION_NAME, contact: t!.config.ASSOCIATION_CONTACT }).split("\n")[0]!.slice(0, 20));
    // Only coordinates went out, and the person's state is back to the menu.
    const out = t!.geo.calls.filter((c) => c.fn !== "geocode").map((c) => Object.keys(c.arg as object).sort());
    expect(out).toEqual([["isoWeekday", "lat", "lon", "radiusM"], ["lat", "lon", "radiusM"]]);
  });

  it("a typed address after menu 5 works like a shared location, and is not kept in the conversation", async () => {
    const { p, bid } = await setup("en");
    t!.geo.addresses.set("gare de l'est", { lat: 48.8768, lon: 2.3592 });
    await p.say("5");
    await p.say("Gare de l'Est");
    expect(plain(await p.last()).startsWith(plain(waText("en", "nearby_title", { distance: "1.5 km" })))).toBe(true);
    const dek = await t!.wdeps.beneficiaries.getDek(bid);
    const inbound = await t!.deps.db.select().from(messages).where(and(eq(messages.beneficiaryId, bid), eq(messages.direction, "in")));
    const bodies = inbound.map((m) => (m.bodyEnc ? t!.deps.crypto.decrypt(dek, m.bodyEnc).toString("utf8") : null));
    expect(bodies).toContain("📍 [adresse]");
    expect(bodies).not.toContain("Gare de l'Est");
    const [b] = await t!.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b!.conversationState).toEqual({ step: "main_menu" });
  });

  it("an address not found asks again; a question goes to the chatbot as usual", async () => {
    const { p, bid } = await setup("en");
    await p.say("5");
    await p.say("12 rue Introuvable");
    expect(await p.last()).toBe(waText("en", "nearby_not_found"));
    await p.say("where can I take a shower?");
    const [b] = await t!.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, bid));
    expect(b!.conversationState).toEqual({ step: "main_menu" });
    expect(t!.geo.calls.filter((c) => c.fn === "geocode").map((c) => c.arg)).toEqual(["12 rue Introuvable"]);
  });

  it("nothing nearby: says so, with the 115", async () => {
    const { p } = await setup("en");
    t!.geo.osm = [];
    t!.geo.soliguide = [];
    await p.share(ME.lat, ME.lon);
    expect(await p.last()).toContain(`${waText("en", "nearby_none")}\n\n${waText("en", "places_115")}`);
  });

  it("in Arabic, names and distances are isolated but links stay clickable", async () => {
    const { p } = await setup("ar");
    await p.share(ME.lat, ME.lon);
    const msg = await p.last();
    expect(msg).toContain("⁨Restos du Cœur République⁩");
    for (const line of msg.split("\n").filter((l) => l.includes("https://"))) expect(line).not.toMatch(/[⁦-⁩‏]/);
  });

  it("GEO_MODE=off: menu 5 is the list of the day only, and a shared location gets it too", async () => {
    const { p } = await setup("en");
    (t!.wdeps as { geo: unknown }).geo = new NoGeo();
    await p.say("5");
    expect(await p.last()).not.toContain(waText("en", "nearby_hint"));
    await p.share(ME.lat, ME.lon);
    expect(await p.last()).toContain(waText("en", "places_none"));
  });

  it("with the real WhatsApp API, only a placeholder is recorded: neither the point nor the list is kept", async () => {
    w = await makeWa({ meta: true, now: `${TODAY}T15:00:00Z` });
    w.tllm.nextLanguage = { language: "en", confidence: 0.95 };
    w.geo.osm = OSM;
    const p = "33650000009";
    await w.say(p, "Hello, I need help");
    await w.share(p, ME.lat, ME.lon);
    expect(w.meta!.texts.at(-1)!.body).toContain("Pharmacie du Temple");
    const bodies = await w.outbound(p);
    expect(bodies.at(-1)).toBe("📍 [Lieux proches envoyés. La position et la liste ne sont pas conservées.]");
    expect(bodies.join("\n")).not.toContain("Pharmacie du Temple");
    const [b] = await w.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, w.deps.crypto.lookupHash(p)));
    const dek = await w.wdeps.beneficiaries.getDek(b!.id);
    const inbound = await w.deps.db.select().from(messages).where(and(eq(messages.beneficiaryId, b!.id), eq(messages.direction, "in")));
    expect(inbound.map((m) => (m.bodyEnc ? w!.deps.crypto.decrypt(dek, m.bodyEnc).toString("utf8") : null))).toContain("📍");
    expect(JSON.stringify(await w.deps.db.select().from(messages))).not.toContain("48.86");
  });
});
