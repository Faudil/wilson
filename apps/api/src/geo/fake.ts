import type { GeoProvider, LatLon, NearbyPoi } from "./provider.js";

/** Tests: addresses and results set by hand, and every outside call recorded (to check what would leave). */
export class FakeGeo implements GeoProvider {
  readonly mode = "fake" as const;
  readonly addresses = new Map<string, LatLon>();
  osm: NearbyPoi[] = [];
  soliguide: NearbyPoi[] = [];
  readonly calls: { fn: "geocode" | "osmAround" | "soliguideAround"; arg: unknown }[] = [];

  async geocode(address: string) {
    this.calls.push({ fn: "geocode", arg: address });
    return this.addresses.get(address.trim().toLowerCase()) ?? null;
  }
  async osmAround(p: LatLon, radiusM: number) {
    this.calls.push({ fn: "osmAround", arg: { ...p, radiusM } });
    return this.osm;
  }
  async soliguideAround(p: LatLon, radiusM: number, isoWeekday: number) {
    this.calls.push({ fn: "soliguideAround", arg: { ...p, radiusM, isoWeekday } });
    return this.soliguide;
  }
}
