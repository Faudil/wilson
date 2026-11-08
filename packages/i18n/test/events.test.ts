import { describe, expect, it } from "bun:test";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { CATALOGS, EVENT_CATALOGS, eventText, menuOptionLabel, type EventKey } from "../src/index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const keys = Object.keys(EVENT_CATALOGS.fr) as EventKey[];
const options = (s: string) => s.split("\n").flatMap((l) => /^\s*(\d{1,2})\s*-\s*\S/.exec(l)?.[1] ?? []);

describe("agenda catalogs", () => {
  it("28 languages with the same keys, non-empty, placeholders identical to fr", () => {
    for (const l of LANGUAGE_CODES) {
      expect(Object.keys(EVENT_CATALOGS[l]).sort(), l).toEqual([...keys].sort());
      for (const k of keys) {
        expect(EVENT_CATALOGS[l][k].trim().length, `${l}.${k}`).toBeGreaterThan(0);
        expect(placeholders(EVENT_CATALOGS[l][k]), `${l}.${k}`).toEqual(placeholders(EVENT_CATALOGS.fr[k]));
      }
    }
  });
  it("menus offer the same numbered options in every language", () => {
    for (const k of keys) {
      const fr = options(EVENT_CATALOGS.fr[k]);
      for (const l of LANGUAGE_CODES) expect(options(EVENT_CATALOGS[l][k]), `${l}.${k}`).toEqual(fr);
    }
    expect(options(EVENT_CATALOGS.fr.events_actions_join)).toEqual(["1", "0"]);
    expect(options(EVENT_CATALOGS.fr.events_actions_registered)).toEqual(["2", "0"]);
  });
  it("menu 8 offers 4 (workshops and meetings) everywhere", () => {
    for (const l of LANGUAGE_CODES) {
      expect(options(CATALOGS[l].help_menu), l).toEqual(["1", "2", "3", "4", "0"]);
      expect(menuOptionLabel(l, "help_menu", 4).length, l).toBeGreaterThan(2);
    }
  });
  it("keeps {summary} raw, isolates nothing else it should not, RLM line starts in RTL", () => {
    const summary = "‏📅 ⁨mardi⁩\n‏📍 ⁨12 rue X⁩";
    const out = eventText("ar", "events_registered", { summary });
    expect(out).toContain(summary.split("\n")[1]!);
    for (const line of out.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
    expect(eventText("fr", "events_spots_left", { n: 3 })).toBe("👥 Places restantes : 3");
  });
});
