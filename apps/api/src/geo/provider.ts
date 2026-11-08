import type { PlaceKind } from "@wilson/contracts";

export interface LatLon {
  lat: number;
  lon: number;
}

/** What a nearby result is, in display order after the volunteers' own places. */
export const NEARBY_KINDS = ["shelter", "food", "shower", "clothes", "health", "other", "water", "toilets", "pharmacy", "transport"] as const;
export type NearbyKind = PlaceKind | "water" | "toilets" | "pharmacy" | "transport";

/** One place found around a point by an outside directory (OpenStreetMap or Soliguide). */
export interface NearbyPoi extends LatLon {
  source: "osm" | "soliguide";
  kind: NearbyKind;
  name: string | null;
  address?: string | null;
  phone?: string | null;
  /** Opening hours today as shown to the person ("09:00–12:00, 14:00–17:00"), when the directory gives them. */
  hoursToday?: string | null;
  /** Page with the full details (Soliguide's fiche). */
  url?: string | null;
}

/**
 * Outside geographic services. Only coordinates or the address text typed by the person are sent, never a phone
 * number or a name, and nothing is written to the database: results are cached in memory by coarse area.
 */
export interface GeoProvider {
  readonly mode: "osm" | "off" | "fake";
  /** Address or landmark ("gare de Lyon", "12 rue …") → point, or null when not found. */
  geocode(address: string): Promise<LatLon | null>;
  /** Free basics around a point (OpenStreetMap): drinking water, toilets, showers, pharmacies, stops, aid places. */
  osmAround(p: LatLon, radiusM: number): Promise<NearbyPoi[]>;
  /** Solidarity services around a point (Soliguide); [] when no key is configured. `isoWeekday` picks today's hours. */
  soliguideAround(p: LatLon, radiusM: number, isoWeekday: number): Promise<NearbyPoi[]>;
}

/** GEO_MODE=off: nothing leaves the server. */
export class NoGeo implements GeoProvider {
  readonly mode = "off" as const;
  async geocode() {
    return null;
  }
  async osmAround() {
    return [];
  }
  async soliguideAround() {
    return [];
  }
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "350 m", "1,2 km": numbers only, readable in every language. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Walking directions to a point. Only the destination is in the link: the person's own position is filled in by
 * their maps app on the phone, so it never appears in our messages.
 */
export function directionsUrl(p: LatLon): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(5)},${p.lon.toFixed(5)}&travelmode=walking`;
}
