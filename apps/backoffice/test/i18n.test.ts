import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import ar from "../src/i18n/ar.json";
import en from "../src/i18n/en.json";
import fr from "../src/i18n/fr.json";
import { format, translate, type MessageKey } from "../src/i18n/core";

const catalogs = { fr, en, ar } as Record<string, Record<string, string>>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("UI catalogs", () => {
  it("have identical keys", () => {
    const base = Object.keys(fr).sort();
    expect(Object.keys(en).sort()).toEqual(base);
    expect(Object.keys(ar).sort()).toEqual(base);
  });

  it("have no empty values and the same placeholders in every language", () => {
    for (const key of Object.keys(fr)) {
      for (const [lang, catalog] of Object.entries(catalogs)) {
        expect(catalog[key]?.trim(), `${lang}:${key}`).toBeTruthy();
        expect(placeholders(catalog[key]!), `${lang}:${key} placeholders`).toEqual(placeholders(fr[key as MessageKey]));
      }
    }
  });

  it("cover every static t('…') key used in the sources", () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        // src/moi (beneficiaries' web space) uses its own 28-language catalogs, typed by WebKey (packages/i18n/src/web).
        if (e.isDirectory()) {
          if (e.name !== "moi") walk(p);
        } else if (p.endsWith(".tsx")) {
          for (const m of readFileSync(p, "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)) used.add(m[1]!);
        }
      }
    };
    walk(join(__dirname, "../src"));
    expect(used.size).toBeGreaterThan(50);
    for (const key of used) expect(Object.keys(fr), key).toContain(key);
  });

  it("have a label for every dynamic key family", async () => {
    const { LetterTypeSchema, LetterStatusSchema, UrgencySchema, DeadlineKindSchema } = await import("@wilson/contracts");
    const need = [
      ...LetterTypeSchema.options.map((v) => `letterType.${v}`),
      ...LetterStatusSchema.options.map((v) => `status.${v}`),
      ...UrgencySchema.options.map((v) => `urgency.${v}`),
      ...DeadlineKindSchema.options.map((v) => `deadlineKind.${v}`),
    ];
    for (const key of need) expect(Object.keys(fr), key).toContain(key);
  });
});

describe("t()", () => {
  it("fills {name} placeholders without concatenation", () => {
    expect(format("Bonjour {name}, {count} documents", { name: "Awa", count: 3 })).toBe("Bonjour Awa, 3 documents");
    expect(format("{a} et {a}", { a: "x" })).toBe("x et x");
  });
  it("leaves unknown placeholders visible", () => {
    expect(format("Salut {who}", {})).toBe("Salut {who}");
  });
  it("falls back to English then French for languages without a catalog", () => {
    expect(translate("fa", "nav.queue")).toBe(en["nav.queue"]);
    expect(translate("ar", "deadline.inDays", { days: 5 })).toBe("بعد 5 يومًا");
    expect(translate("fr", "deadline.inDays", { days: 5 })).toBe("dans 5 jours");
  });
});
