import { describe, expect, it } from "bun:test";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { BUDDY_CATALOGS, CATALOGS, buddyHow, buddyText, type BuddyKey } from "../src/index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const keys = Object.keys(BUDDY_CATALOGS.fr) as BuddyKey[];
/** "N - Label" option numbers of a menu text. */
const options = (s: string) => s.split("\n").flatMap((l) => /^\s*(\d{1,2})\s*-\s*\S/.exec(l)?.[1] ?? []);

describe("buddy catalogs", () => {
  it("28 languages with the same keys, non-empty, placeholders identical to fr", () => {
    for (const l of LANGUAGE_CODES) {
      expect(Object.keys(BUDDY_CATALOGS[l]).sort(), l).toEqual([...keys].sort());
      for (const k of keys) {
        expect(BUDDY_CATALOGS[l][k].trim().length, `${l}.${k}`).toBeGreaterThan(0);
        expect(placeholders(BUDDY_CATALOGS[l][k]), `${l}.${k}`).toEqual(placeholders(BUDDY_CATALOGS.fr[k]));
      }
    }
  });
  it("menus offer the same numbered options in every language", () => {
    for (const k of keys) {
      const fr = options(BUDDY_CATALOGS.fr[k]);
      for (const l of LANGUAGE_CODES) expect(options(BUDDY_CATALOGS[l][k]), `${l}.${k}`).toEqual(fr);
    }
    expect(options(BUDDY_CATALOGS.fr.buddy_intro)).toEqual(["1", "2", "3", "4", "0"]);
    expect(options(BUDDY_CATALOGS.fr.buddy_menu)).toEqual(["1", "2", "3", "4", "5", "0"]);
  });
  it("main menu offers 7 everywhere; the report confirmation gives the emergency numbers", () => {
    for (const l of LANGUAGE_CODES) {
      expect(CATALOGS[l].main_menu, l).toMatch(/\n7 - /);
      expect(BUDDY_CATALOGS[l].buddy_report_received, l).toMatch(/(^|\D)17(\D|$)/);
      expect(BUDDY_CATALOGS[l].buddy_report_received, l).toMatch(/112/);
    }
  });
  it("isolates the name, keeps `how` raw, RLM line starts in RTL", () => {
    const how = buddyHow("ar", "meet", "Café Le Zinc, Paris 10e");
    expect(how).toContain("⁨Café Le Zinc, Paris 10e⁩");
    const out = buddyText("ar", "buddy_proposal", { name: "Marie", date: "١٢ نوفمبر", time: "18:30", how });
    expect(out).toContain("⁨Marie⁩");
    expect(out).toContain(how);
    for (const line of out.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
    expect(buddyHow("fr", "call", null)).toBe("Par appel téléphonique.");
  });
});
