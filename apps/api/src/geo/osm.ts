import type { Config } from "../config.js";
import type { GeoProvider, LatLon, NearbyKind, NearbyPoi } from "./provider.js";

type Fetch = typeof fetch;
type GeoConfig = Pick<Config, "ASSOCIATION_NAME" | "NEARBY_COUNTRIES" | "NOMINATIM_URL" | "OVERPASS_URL" | "OSM_CONTACT_EMAIL" | "SOLIGUIDE_API_KEY" | "SOLIGUIDE_API_URL">;

/** Small in-memory cache with a time limit and a size cap (oldest entry dropped first). Never written to disk. */
export class TtlCache<V> {
  private readonly m = new Map<string, { v: V; exp: number }>();
  constructor(private readonly max: number, private readonly now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V, ttlMs: number): void {
    this.m.delete(k);
    this.m.set(k, { v, exp: this.now() + ttlMs });
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
}

const HOUR = 3_600_000;
/**
 * Results are cached per ~1 km cell (coordinates rounded to 0.01°), so people in the same area share one request
 * and the cache never holds anyone's exact position. The cell is queried a bit wider than the radius, then the
 * caller keeps what is within the radius of the person's own point.
 */
const CELL = 100;
const CELL_MARGIN_M = 800;
const cell = (p: LatLon): LatLon => ({ lat: Math.round(p.lat * CELL) / CELL, lon: Math.round(p.lon * CELL) / CELL });
const cellKey = (c: LatLon, r: number) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)},${r}`;

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const hhmm = (n: number) => `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;

type OsmElement = { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** OpenStreetMap tags → what the person is looking for. */
export function osmKind(t: Record<string, string>): NearbyKind | null {
  if (t.amenity === "drinking_water") return "water";
  if (t.amenity === "toilets") return "toilets";
  if (t.amenity === "shower") return "shower";
  if (t.amenity === "pharmacy") return "pharmacy";
  if (t.amenity === "food_bank" || t.social_facility === "soup_kitchen") return "food";
  if (t.amenity === "social_facility") return t.social_facility === "shelter" ? "shelter" : "other";
  if (t.highway === "bus_stop" || t.public_transport === "station") return "transport";
  return null;
}

export function overpassQuery(c: LatLon, radiusM: number): string {
  const around = `(around:${radiusM},${c.lat},${c.lon})`;
  const stops = `(around:${Math.min(radiusM, 700)},${c.lat},${c.lon})`;
  const open = `["access"!~"^(private|customers|no|permissive_customers)$"]`;
  return `[out:json][timeout:15];(
nwr["amenity"="drinking_water"]${around};
nwr["amenity"="toilets"]${open}${around};
nwr["amenity"="shower"]${open}${around};
nwr["amenity"="pharmacy"]${around};
nwr["amenity"="food_bank"]${around};
nwr["amenity"="social_facility"]["social_facility:for"~"homeless|migrant|underprivileged"]${around};
nwr["social_facility"="soup_kitchen"]${around};
node["highway"="bus_stop"]${stops};
nwr["public_transport"="station"]${stops};
);out center tags 400;`;
}

export function parseOverpass(json: unknown): NearbyPoi[] {
  const elements = (json as { elements?: OsmElement[] })?.elements ?? [];
  return elements.flatMap((e): NearbyPoi[] => {
    const t = e.tags ?? {};
    const kind = osmKind(t);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!kind || lat === undefined || lon === undefined) return [];
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    return [{
      source: "osm", kind, lat, lon,
      name: t["name:fr"] ?? t.name ?? null,
      address: street || null,
      phone: t.phone ?? t["contact:phone"] ?? null,
      hoursToday: t.opening_hours === "24/7" ? "24/7" : null,
    }];
  });
}

/** Soliguide categories (current string ids, or the older numbers) → kind, most specific need first. */
export function soliguideKind(categories: (string | number)[]): NearbyKind {
  const cats = categories.map((c) => String(c).toLowerCase());
  const has = (re: RegExp) => cats.some((c) => re.test(c));
  if (has(/accommodation|housing|shelter|hebergement/)) return "shelter";
  if (has(/food|alimentation|^6\d\d$/)) return "food";
  if (has(/shower|douche|hygiene|^4\d\d$/)) return "shower";
  if (has(/cloth|vetement|vêtement/)) return "clothes";
  if (has(/health|medical|dental|psych|sante|santé|^1\d\d$/)) return "health";
  return "other";
}

type SoliguideDay = { open?: boolean; timeslot?: { start: number; end: number }[] };
type SoliguidePlace = {
  lieu_id?: number;
  seo_url?: string;
  name?: string;
  position?: { adresse?: string; address?: string; location?: { coordinates?: [number, number] } };
  entity?: { phone?: string; phones?: { phoneNumber?: string }[] };
  services_all?: { category?: string | number }[];
  newhours?: Partial<Record<(typeof WEEKDAYS)[number], SoliguideDay>>;
};

/** Soliguide `new-search` answer → places open today (closed today = left out; no hours given = kept). */
export function parseSoliguide(json: unknown, isoWeekday: number): NearbyPoi[] {
  const list = (json as { places?: SoliguidePlace[] })?.places ?? [];
  const day = WEEKDAYS[isoWeekday - 1]!;
  return list.flatMap((p): NearbyPoi[] => {
    const coords = p.position?.location?.coordinates;
    if (!p.name || !coords || coords.length < 2) return [];
    const today = p.newhours?.[day];
    if (today && today.open === false) return [];
    const slots = today?.timeslot?.filter((s) => typeof s.start === "number" && typeof s.end === "number") ?? [];
    return [{
      source: "soliguide",
      kind: soliguideKind((p.services_all ?? []).flatMap((s) => (s.category === undefined ? [] : [s.category]))),
      name: p.name,
      lat: coords[1], lon: coords[0],
      address: p.position?.adresse ?? p.position?.address ?? null,
      phone: p.entity?.phones?.[0]?.phoneNumber ?? p.entity?.phone ?? null,
      hoursToday: slots.length ? slots.map((s) => `${hhmm(s.start)}–${hhmm(s.end)}`).join(", ") : null,
      url: p.seo_url || p.lieu_id ? `https://soliguide.fr/fr/fiche/${p.seo_url ?? p.lieu_id}` : null,
    }];
  });
}

/**
 * OpenStreetMap (Nominatim + Overpass) and, with a key, Soliguide. Follows the OSM usage policies: an identifying
 * User-Agent with a contact, at most one Nominatim request per second, results cached, no autocomplete.
 */
export class OsmGeoProvider implements GeoProvider {
  readonly mode = "osm" as const;
  private readonly addresses = new TtlCache<LatLon | null>(2000);
  private readonly osm = new TtlCache<NearbyPoi[]>(500);
  private readonly soli = new TtlCache<NearbyPoi[]>(500);
  private nominatimQueue: Promise<unknown> = Promise.resolve();
  private lastNominatim = 0;

  constructor(private readonly config: GeoConfig, private readonly doFetch: Fetch = fetch) {}

  private get userAgent(): string {
    const contact = this.config.OSM_CONTACT_EMAIL ? `; ${this.config.OSM_CONTACT_EMAIL}` : "";
    return `Wilson/1.0 (WhatsApp help desk of ${this.config.ASSOCIATION_NAME}${contact})`;
  }

  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.doFetch(url, {
      ...init,
      headers: { "User-Agent": this.userAgent, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
  }

  /** One Nominatim request at a time, at least 1.1 s apart (their policy: 1 per second at most). */
  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.nominatimQueue.then(async () => {
      const wait = this.lastNominatim + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastNominatim = Date.now();
      }
    });
    this.nominatimQueue = run.catch(() => undefined);
    return run;
  }

  async geocode(address: string): Promise<LatLon | null> {
    const q = address.trim().replace(/\s+/g, " ").slice(0, 200);
    if (q.length < 3) return null;
    const key = q.toLowerCase();
    const hit = this.addresses.get(key);
    if (hit !== undefined) return hit;
    try {
      const params = new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: this.config.NEARBY_COUNTRIES, "accept-language": "fr" });
      if (this.config.OSM_CONTACT_EMAIL) params.set("email", this.config.OSM_CONTACT_EMAIL);
      const rows = (await this.throttled(() => this.json(`${this.config.NOMINATIM_URL.replace(/\/$/, "")}/search?${params}`))) as { lat?: string; lon?: string }[];
      const r = rows?.[0];
      const p = r?.lat && r?.lon ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
      const point = p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
      this.addresses.set(key, point, point ? 24 * HOUR : HOUR);
      return point;
    } catch (e) {
      console.error("[geo] geocoding failed:", e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async osmAround(p: LatLon, radiusM: number): Promise<NearbyPoi[]> {
    const c = cell(p);
    const key = cellKey(c, radiusM);
    const hit = this.osm.get(key);
    if (hit) return hit;
    try {
      const body = new URLSearchParams({ data: overpassQuery(c, radiusM + CELL_MARGIN_M) });
      const pois = parseOverpass(await this.json(this.config.OVERPASS_URL, {
        method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }));
      this.osm.set(key, pois, 6 * HOUR);
      return pois;
    } catch (e) {
      console.error("[geo] overpass failed:", e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  async soliguideAround(p: LatLon, radiusM: number, isoWeekday: number): Promise<NearbyPoi[]> {
    const token = this.config.SOLIGUIDE_API_KEY;
    if (!token) return [];
    const c = cell(p);
    const key = `${cellKey(c, radiusM)},${isoWeekday}`;
    const hit = this.soli.get(key);
    if (hit) return hit;
    try {
      const json = await this.json(`${this.config.SOLIGUIDE_API_URL.replace(/\/$/, "")}/new-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token.startsWith("JWT ") ? token : `JWT ${token}` },
        body: JSON.stringify({
          location: { geoType: "position", coordinates: [c.lon, c.lat], distance: (radiusM + CELL_MARGIN_M) / 1000 },
          options: { limit: 50 },
        }),
      });
      const pois = parseSoliguide(json, isoWeekday);
      this.soli.set(key, pois, HOUR);
      return pois;
    } catch (e) {
      console.error("[geo] soliguide failed:", e instanceof Error ? e.message : String(e));
      return [];
    }
  }
}
