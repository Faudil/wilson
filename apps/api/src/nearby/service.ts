import { isRtl, type LanguageCode, type PlaceKind } from "@wilson/contracts";
import { isolate, waText } from "@wilson/i18n";
import type { Deps } from "../deps.js";
import { directionsUrl, distanceM, formatDistance, type LatLon, type NearbyKind, type NearbyPoi } from "../geo/provider.js";
import { getPlaces, isoWeekday, PLACE_EMOJI, type PlaceRow } from "../places/service.js";
import { todayIn } from "../whatsapp/context.js";

type NearbyDeps = Pick<Deps, "db" | "llm" | "config" | "now" | "geo">;

const EMOJI: Record<NearbyKind, string> = { ...PLACE_EMOJI, water: "💧", toilets: "🚻", pharmacy: "💊", transport: "🚏" };
/** Free basics with no useful name of their own: shown with a label in the person's language. */
const LABEL = { water: "nearby_water", toilets: "nearby_toilets", shower: "nearby_shower", pharmacy: "nearby_pharmacy" } as const;
/** One nearest of each basic, after the aid places. */
const BASICS: NearbyKind[] = ["water", "toilets", "shower", "pharmacy", "transport"];
const AID: NearbyKind[] = ["shelter", "food", "shower", "clothes", "health", "other"];
const MAX_OURS = 4;
const MAX_AID = 5;
const MAX_CHARS = 3800; // WhatsApp's limit is 4096; the footer follows

type Item = { kind: NearbyKind; name: string | null; d: number; point: LatLon; address?: string | null; phone?: string | null; hours?: string | null; details?: string | null; url?: string | null };

const near = (a: Item, b: Item, m: number) => distanceM(a.point, b.point) < m;

/**
 * The WhatsApp text listing what is open near `point` today:
 * 1. the volunteers' own places of the day (when their address was found on the map), up to 3× the radius;
 * 2. Soliguide's solidarity services (when a key is configured), else OpenStreetMap's aid places;
 * 3. the nearest drinking water, toilets, shower, pharmacy and stop (OpenStreetMap).
 * Each with its distance and a walking-directions link to the destination only. The point is not kept anywhere.
 */
export async function nearbyMessage(deps: NearbyDeps, point: LatLon, lang: LanguageCode, beneficiaryId: string | null): Promise<string> {
  const { geo, config } = deps;
  const radius = config.NEARBY_RADIUS_M;
  const today = todayIn(deps.now(), config.TIMEZONE);
  const places = getPlaces(deps);
  const [rows, soli, osm] = await Promise.all([
    places.openOn(today),
    geo.soliguideAround(point, radius, isoWeekday(today)),
    geo.osmAround(point, radius),
  ]);

  const ours: Item[] = (await Promise.all(
    rows
      .filter((r): r is PlaceRow & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
      .map((r) => ({ r, d: distanceM(point, { lat: r.lat, lon: r.lon }) }))
      .filter((x) => x.d <= radius * 3)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_OURS)
      .map(async ({ r, d }): Promise<Item> => {
        const { name, details } = await places.localized(r, lang, beneficiaryId);
        const hours = r.opensAt && r.closesAt ? `${r.opensAt}–${r.closesAt}` : (r.opensAt ?? r.closesAt);
        return { kind: r.kind as PlaceKind, name, d, point: { lat: r.lat, lon: r.lon }, address: r.address, phone: r.phone, hours, details };
      }),
  ));

  const toItem = (p: NearbyPoi): Item => ({ kind: p.kind, name: p.name, d: distanceM(point, p), point: p, address: p.address, phone: p.phone, hours: p.hoursToday, url: p.url });
  const within = (list: NearbyPoi[]) => list.map(toItem).filter((i) => i.d <= radius).sort((a, b) => a.d - b.d);

  // Aid places from the directories, minus those the volunteers already posted (same spot).
  const aidSource = soli.length ? soli : osm.filter((p) => AID.includes(p.kind) && p.kind !== "shower" && p.name);
  const aid: Item[] = [];
  for (const i of within(aidSource)) {
    if (aid.length >= MAX_AID) break;
    if (!ours.some((o) => near(o, i, 80)) && !aid.some((a) => near(a, i, 30))) aid.push(i);
  }

  const osmItems = within(osm);
  const basics = BASICS.flatMap((k) => {
    const i = osmItems.find((x) => x.kind === k && (k !== "transport" || x.name));
    return i && ![...ours, ...aid].some((o) => o.kind === k && near(o, i, 40)) ? [i] : [];
  });

  if (!ours.length && !aid.length && !basics.length) {
    return [waText(lang, "nearby_none"), waText(lang, "places_115")].join("\n\n");
  }

  const iso = (s: string) => (isRtl(lang) ? isolate(s) : s);
  const block = (i: Item): string => {
    const label = i.name ?? (i.kind in LABEL ? waText(lang, LABEL[i.kind as keyof typeof LABEL]) : null) ?? "";
    const lines = [`${EMOJI[i.kind]} *${iso(label)}* · ${iso(formatDistance(i.d))}`];
    if (i.hours) lines.push(`🕘 ${iso(i.hours)}`);
    if (i.address) lines.push(`📍 ${iso(i.address)}`);
    if (i.phone) lines.push(`📞 ${iso(i.phone)}`);
    if (i.details) lines.push(i.details);
    // URLs stay on their own line, never wrapped in bidi marks (WhatsApp would not make them clickable).
    lines.push(`🧭 ${directionsUrl(i.point)}`);
    if (i.url) lines.push(`ℹ️ ${i.url}`);
    return lines.join("\n");
  };

  const parts = [waText(lang, "nearby_title", { distance: formatDistance(radius) })];
  let size = parts[0]!.length;
  const closing = [waText(lang, "places_115"), `© OpenStreetMap${soli.length ? " · Soliguide" : ""}`];
  const budget = MAX_CHARS - closing.join("\n\n").length;
  for (const i of [...ours, ...aid, ...basics]) {
    const b = block(i);
    if (size + b.length + 2 > budget) break;
    parts.push(b);
    size += b.length + 2;
  }
  return [...parts, ...closing].join("\n\n");
}

/** A typed reply that is probably an address or a landmark rather than a question. */
export function looksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 120 || /[?؟？]/.test(t)) return false;
  return /\d/.test(t) || t.split(/\s+/).length <= 6;
}
