import type { Config } from "../config.js";
import { OsmGeoProvider } from "./osm.js";
import { NoGeo, type GeoProvider } from "./provider.js";

export function createGeoProvider(config: Config, doFetch: typeof fetch = fetch): GeoProvider {
  return config.GEO_MODE === "osm" ? new OsmGeoProvider(config, doFetch) : new NoGeo();
}
export * from "./provider.js";
