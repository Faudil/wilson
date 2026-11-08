import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { LANGUAGE_CODES, LANGUAGES } from "@wilson/contracts/values";
import en from "../src/i18n/en.json";
import fr from "../src/i18n/fr.json";
import { CATALOGS, format, loadCatalog, MACHINE_TRANSLATED, translate, UI_LANGUAGES, type MessageKey } from "../src/i18n/core";

const i18nDir = join(__dirname, "../src/i18n");
const catalogs = Object.fromEntries(
  LANGUAGE_CODES.map((lang) => [lang, JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), "utf8")) as Record<string, string>]),
);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("UI catalogs", () => {
  it("exist for every WhatsApp language, and the picker offers them all", () => {
    expect([...UI_LANGUAGES].sort()).toEqual([...LANGUAGE_CODES].sort());
  });

  it("French, English and Arabic have identical keys", () => {
    const base = Object.keys(fr).sort();
    for (const lang of ["en", "ar"]) expect(Object.keys(catalogs[lang]!).sort(), lang).toEqual(base);
  });

  // The other catalogs are machine translations that may lag behind: a key
  // that is missing falls back to English, so new keys only need fr/en/ar.
  // A key that no longer exists in French must be removed everywhere.
  it("other catalogs hold no stale keys", () => {
    for (const [lang, catalog] of Object.entries(catalogs)) {
      const stale = Object.keys(catalog).filter((k) => !(k in fr));
      expect(stale, lang).toEqual([]);
    }
  });

  it("flag machine translations only for languages that have a catalog, never French or English", () => {
    for (const lang of MACHINE_TRANSLATED) expect(UI_LANGUAGES as readonly string[], lang).toContain(lang);
    expect(MACHINE_TRANSLATED.has("fr")).toBe(false);
    expect(MACHINE_TRANSLATED.has("en")).toBe(false);
  });

  it("are not just English copies (except names and acronyms)", () => {
    for (const [lang, catalog] of Object.entries(catalogs)) {
      if (lang === "en") continue;
      const same = Object.keys(en).filter((k) => catalog[k] === en[k as MessageKey] && /[a-z]{4,} [a-z]{4,}/i.test(en[k as MessageKey]));
      expect(same.length, `${lang}: ${same.slice(0, 5).join(", ")}`).toBeLessThan(15);
    }
  });

  it("are written in the language's own script", () => {
    const scripts: Record<string, RegExp> = { Arab: /\p{Script=Arabic}/u, Cyrl: /\p{Script=Cyrillic}/u, Ethi: /\p{Script=Ethiopic}/u, Beng: /\p{Script=Bengali}/u, Taml: /\p{Script=Tamil}/u, Geor: /\p{Script=Georgian}/u, Armn: /\p{Script=Armenian}/u };
    for (const lang of LANGUAGE_CODES) {
      const re = scripts[LANGUAGES[lang].script];
      if (re) expect(re.test(catalogs[lang]!["nav.home"]!), `${lang}: ${catalogs[lang]!["nav.home"]}`).toBe(true);
    }
  });

  it("have no empty values and the same placeholders in every language", () => {
    for (const key of Object.keys(fr)) {
      for (const [lang, catalog] of Object.entries(catalogs)) {
        // A machine-translated catalog may lack a newer key: it falls back to English (see above).
        if (!(key in catalog) && !["fr", "en", "ar"].includes(lang)) continue;
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
  it("falls back to English until a language's catalog is loaded", async () => {
    delete CATALOGS.fa;
    expect(translate("fa", "nav.queue")).toBe(en["nav.queue"]);
    await loadCatalog("fa");
    expect(translate("fa", "nav.queue")).toBe(catalogs.fa!["nav.queue"]!);
  });
  it("loads catalogs on demand", async () => {
    await loadCatalog("ar");
    expect(translate("ar", "deadline.inDays", { days: 5 })).toBe("بعد 5 يومًا");
    await loadCatalog("wo");
    expect(translate("wo", "nav.home")).toBe(catalogs.wo!["nav.home"]!);
    expect(translate("fr", "deadline.inDays", { days: 5 })).toBe("dans 5 jours");
  });
});
