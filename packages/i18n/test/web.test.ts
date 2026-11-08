import { describe, expect, it } from "bun:test";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { WEB_CATALOGS, WEB_KEYS, webText } from "../src/index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("web space catalogs", () => {
  it("28 languages with every key, non-empty, placeholders identical to fr", () => {
    for (const l of LANGUAGE_CODES) {
      expect(Object.keys(WEB_CATALOGS[l]).sort(), l).toEqual([...WEB_KEYS].sort());
      for (const k of WEB_KEYS) {
        expect(WEB_CATALOGS[l][k].trim().length, `${l}.${k}`).toBeGreaterThan(0);
        expect(placeholders(WEB_CATALOGS[l][k]), `${l}.${k}`).toEqual(placeholders(WEB_CATALOGS.fr[k]));
      }
    }
  });
  it("isolates user values, not numbers", () => {
    expect(webText("ar", "hello", { name: "Amina" })).toContain("⁨Amina⁩");
    expect(webText("fr", "step_of", { n: 2, total: 4 })).toBe("Étape 2 sur 4");
  });
});
