import { describe, expect, it } from "vitest";
import { LANGUAGE_CODES, DocumentTypeSchema } from "@wilson/contracts";
import {
  CATALOGS,
  documentTypeName,
  formatDate,
  isolate,
  languageFromMenuChoice,
  parseUserDate,
  renderLetterReply,
  waText,
  type WaKey,
} from "../src/index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const keys = Object.keys(CATALOGS.fr) as WaKey[];

describe("catalogs", () => {
  it("has 10 languages and the same keys everywhere", () => {
    expect(LANGUAGE_CODES).toHaveLength(10);
    for (const l of LANGUAGE_CODES) expect(Object.keys(CATALOGS[l]).sort()).toEqual([...keys].sort());
  });
  it("every key non-empty with placeholders identical to fr", () => {
    for (const l of LANGUAGE_CODES)
      for (const k of keys) {
        const v = CATALOGS[l][k];
        expect(v.trim().length, `${l}.${k}`).toBeGreaterThan(0);
        expect(placeholders(v), `${l}.${k}`).toEqual(placeholders(CATALOGS.fr[k]));
      }
  });
  it("language_menu is identical and lists 10 languages", () => {
    for (const l of LANGUAGE_CODES) expect(CATALOGS[l].language_menu).toBe(CATALOGS.fr.language_menu);
    expect(CATALOGS.fr.language_menu.split("\n")).toHaveLength(10);
  });
  it("footer mentions legal advice placeholders", () => {
    for (const l of LANGUAGE_CODES) expect(placeholders(CATALOGS[l].footer)).toEqual(["contact", "name"]);
  });
  it("pashto uses its specific letters", () => {
    const all = Object.values(CATALOGS.ps).join("");
    for (const ch of "ټډړږښګڼ") expect(all, ch).toContain(ch);
  });
  it("waText isolates params and starts RTL lines with RLM", () => {
    const t = waText("ar", "human_contact", { name: "Asso", contact: "+33 1 23" });
    expect(t).toContain("⁨Asso⁩");
    expect(t.startsWith("‏")).toBe(true);
    expect(waText("fr", "human_contact", { name: "A", contact: "B" })).toBe("Pour parler à une personne : ⁨A⁩, ⁨B⁩.");
  });
});

describe("isolate", () => {
  it("wraps once", () => {
    expect(isolate("abc")).toBe("⁨abc⁩");
    expect(isolate(isolate("abc"))).toBe("⁨abc⁩");
  });
});

describe("formatDate", () => {
  it.each(LANGUAGE_CODES)("%s is written out, not numeric DD/MM", (l) => {
    for (const weekday of [false, true]) {
      const s = formatDate("2027-03-14", l, { weekday });
      expect(s).not.toMatch(/\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{2,4}/);
      expect(s).not.toContain("/");
      expect(s).toMatch(/14|١٤|۱۴/);
      expect(s).not.toMatch(/۱۴۰۵|AP/); // Persian calendar must not leak
    }
  });
  it("ar has both digit systems", () => {
    const s = formatDate("2027-03-14", "ar");
    expect(s).toContain("١٤");
    expect(s).toContain("14");
    expect(s).toContain("(");
  });
  it("fa and ps use Gregorian with native + Western digits", () => {
    expect(formatDate("2027-03-14", "fa")).toMatch(/۱۴.*\(.*14.*2027\)/);
    expect(formatDate("2027-03-14", "ps")).toMatch(/۱۴.*\(.*14.*2027\)/);
  });
  it("fr / en with weekday, no off-by-one", () => {
    expect(formatDate("2027-03-14", "fr", { weekday: true })).toBe("dimanche 14 mars 2027");
    expect(formatDate("2027-03-14", "en", { weekday: true })).toContain("Sunday");
    expect(formatDate("2027-12-31", "fr")).toBe("31 décembre 2027");
  });
  it("ti / so / am use built-in names (identical in Node and browsers)", () => {
    for (const l of ["ti", "so", "am"] as const) {
      for (const weekday of [false, true]) {
        const s = formatDate("2027-03-14", l, { weekday });
        expect(s).not.toMatch(/M\d{2}/);
        expect(s).not.toMatch(/March|Sunday|Mar\b/);
        expect(s).toContain("14");
        expect(s).toContain("2027");
      }
    }
    expect(formatDate("2027-03-14", "so", { weekday: true })).toBe("Axad 14 Maarso 2027");
    expect(formatDate("2027-03-14", "ti")).toBe("14 መጋቢት 2027");
    expect(formatDate("2027-03-14", "am")).toBe("14 ማርች 2027");
  });
  it("all 10 languages format without throwing", () => {
    for (const l of LANGUAGE_CODES) expect(formatDate("2027-03-14", l).length).toBeGreaterThan(5);
  });
  it("rejects invalid input", () => {
    expect(() => formatDate("2027-02-31", "fr")).toThrow();
  });
});

describe("parseUserDate", () => {
  it.each([
    ["14/03/2027", "2027-03-14"],
    ["14-3-27", "2027-03-14"],
    ["14.03.2027", "2027-03-14"],
    [" 14 / 03 / 2027 ", "2027-03-14"],
    ["١٤/٠٣/٢٠٢٧", "2027-03-14"],
    ["۱۴/۰۳/۲۰۲۷", "2027-03-14"],
    ["1/2/27", "2027-02-01"],
    ["29/02/2028", "2028-02-29"],
  ])("%s", (i, o) => expect(parseUserDate(i)).toBe(o));
  it.each(["31/02/2027", "29/02/2027", "32/01/2027", "00/01/2027", "14/13/2027", "abc", "", "14/03", "2027-03-14"])("invalid %s", (i) =>
    expect(parseUserDate(i)).toBeNull(),
  );
});

describe("documentTypeName", () => {
  it("covers all types in all languages; non-fr keeps the French term", () => {
    for (const t of DocumentTypeSchema.options)
      for (const l of LANGUAGE_CODES) {
        const n = documentTypeName(t, l);
        expect(n.length).toBeGreaterThan(0);
        if (l !== "fr" && t !== "other" || (l !== "fr" && t === "other")) expect(n).toMatch(/\(.+\)/);
      }
    expect(documentTypeName("titre_de_sejour", "en")).toBe("residence permit (titre de séjour)");
  });
});

describe("languageFromMenuChoice", () => {
  it("accepts numbers, Arabic-Indic digits and names", () => {
    expect(languageFromMenuChoice("1")).toBe("fr");
    expect(languageFromMenuChoice("١٠")).toBe("am");
    expect(languageFromMenuChoice("3")).toBe("ar");
    expect(languageFromMenuChoice("11")).toBeNull();
    expect(languageFromMenuChoice("0")).toBeNull();
    expect(languageFromMenuChoice("Soomaali")).toBe("so");
    expect(languageFromMenuChoice("دری")).toBe("fa");
    expect(languageFromMenuChoice("bonjour")).toBeNull();
  });
});

describe("renderLetterReply", () => {
  const base = {
    text: {
      title: "رسالة من الإدارة",
      summary: "هذه الرسالة تطلب منك الحضور.",
      actions: ["احضر إلى 12 rue de la Paix, 75011 Paris", "أحضر جواز السفر"],
      orientation: ["اتصل بالمكتب في 12 rue de la Paix, 75011 Paris"],
    },
    deadline: { date: "2027-03-14", kind: "appointment" as const, explicit: true, sourceQuote: "" },
    urgency: "high" as const,
    today: "2027-03-02",
    association: { name: "Asso", contact: "+33 1 23 45 67 89" },
  };
  it("ar: isolates French address, includes footer, urgency, RLM lines, days left", () => {
    const out = renderLetterReply({ lang: "ar", ...base });
    expect(out).toContain("⁨12 rue de la Paix, 75011 Paris⁩");
    expect(out).toContain("⁨+33 1 23 45 67 89⁩");
    expect(out).toContain("ℹ️");
    expect(out).toContain("⚠️");
    expect(out).toContain("١٤");
    for (const line of out.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(4096);
  });
  it("fr: relative days, today, passed", () => {
    const t = { title: "T", summary: "S", actions: ["a"], orientation: ["o"] };
    const mk = (today: string, urgency: "low" | "high" = "low") =>
      renderLetterReply({ lang: "fr", text: t, deadline: { ...base.deadline }, urgency, today, association: base.association });
    expect(mk("2027-03-02")).toContain("dimanche 14 mars 2027");
    expect(mk("2027-03-02")).toContain("dans 12 jours");
    expect(mk("2027-03-14")).toContain("aujourd'hui");
    expect(mk("2027-03-13")).toContain("demain");
    expect(mk("2027-03-20")).toContain("date dépassée");
    expect(mk("2027-03-02")).not.toContain("⚠️");
    expect(mk("2027-03-02", "high")).toContain("⚠️");
  });
  it("no deadline and truncation to 4096", () => {
    const out = renderLetterReply({
      lang: "en",
      text: { title: "T", summary: "x".repeat(1500), actions: Array(6).fill("y".repeat(400)), orientation: Array(4).fill("z".repeat(400)) },
      deadline: null,
      urgency: "low",
      today: "2027-03-02",
      association: base.association,
    });
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(out).toContain("not legal advice");
    expect(out).not.toContain("📅");
  });
  it("renders in every language", () => {
    for (const lang of LANGUAGE_CODES) expect(renderLetterReply({ lang, ...base })).toContain("Asso");
  });
});
