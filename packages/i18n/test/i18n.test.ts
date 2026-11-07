import { describe, expect, it } from "bun:test";
import { LANGUAGES, LANGUAGE_CODES, DocumentTypeSchema } from "@wilson/contracts";
import {
  CATALOGS,
  dirOf,
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
  it("has 28 languages and the same keys everywhere", () => {
    expect(LANGUAGE_CODES).toHaveLength(28);
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
  it("language_menu is identical and lists 28 languages, one per line", () => {
    for (const l of LANGUAGE_CODES) expect(CATALOGS[l].language_menu).toBe(CATALOGS.fr.language_menu);
    const lines = CATALOGS.fr.language_menu.split("\n");
    expect(lines).toHaveLength(28);
    expect(lines.map((x) => Number(x.split(" - ")[0]))).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    lines.forEach((x, i) => expect(x).toBe(`${i + 1} - ${LANGUAGES[LANGUAGE_CODES[i]!].nativeName}`));
  });
  it("main_menu offers option 4 and chat_urgent lists emergency numbers", () => {
    for (const l of LANGUAGE_CODES) {
      expect(CATALOGS[l].main_menu, l).toMatch(/\n4 - /);
      for (const n of ["115", "15", "17", "112", "119", "114"]) expect(CATALOGS[l].chat_urgent, `${l} ${n}`).toMatch(new RegExp(`(^|\\D)${n}(\\D|$)`));
    }
  });
  it("sorani and kurmanji use their own orthography", () => {
    const ckb = Object.values(CATALOGS.ckb).join("");
    for (const ch of "ڕڵۆێە") expect(ckb, ch).toContain(ch);
    const ku = Object.values(CATALOGS.ku).join("");
    for (const ch of "êîûçş") expect(ku, ch).toContain(ch);
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
  it("no English month or weekday names except in en", () => {
    for (const l of LANGUAGE_CODES) {
      if (l === "en") continue;
      for (const weekday of [false, true])
        expect(formatDate("2027-03-14", l, { weekday }), l).not.toMatch(/March|Sunday|Mar\b/);
    }
  });
  it("hand-made tables: ht, ku, ckb, sw", () => {
    expect(formatDate("2027-03-14", "ht")).toBe("14 mas 2027");
    expect(formatDate("2027-03-14", "ht", { weekday: true })).toBe("dimanch 14 mas 2027");
    expect(formatDate("2027-03-14", "ku")).toBe("14 Adar 2027");
    expect(formatDate("2027-03-14", "sw", { weekday: true })).toBe("Jumapili 14 Machi 2027");
  });
  it("ckb and bn show native digits plus Western form", () => {
    expect(formatDate("2027-03-14", "ckb")).toBe("١٤ ئازار ٢٠٢٧ (14 ئازار 2027)");
    expect(formatDate("2027-03-14", "bn")).toMatch(/১৪.*\(.*14.*2027\)/);
    for (const l of ["ru", "es", "pt", "tr", "ka", "ta", "hy", "sq", "ro", "wo", "ff", "bm", "ln"] as const)
      expect(formatDate("2027-03-14", l), l).not.toMatch(/[٠-٩۰-۹০-৯]/);
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
  it("all languages format without throwing", () => {
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
    expect(languageFromMenuChoice("11")).toBe("ru");
    expect(languageFromMenuChoice("29")).toBeNull();
    expect(languageFromMenuChoice("0")).toBeNull();
    expect(languageFromMenuChoice("Soomaali")).toBe("so");
    expect(languageFromMenuChoice("دری")).toBe("fa");
    expect(languageFromMenuChoice("bonjour")).toBeNull();
  });
  it("accepts 1..28 in all digit systems, ISO codes and names (case-insensitive)", () => {
    expect(languageFromMenuChoice("28")).toBe("sw");
    expect(languageFromMenuChoice("۲۸")).toBe("sw");
    expect(languageFromMenuChoice("٢٨")).toBe("sw");
    expect(languageFromMenuChoice("২৮")).toBe("sw");
    expect(languageFromMenuChoice("১৭")).toBe("bn");
    expect(languageFromMenuChoice("kurdî")).toBe("ku");
    expect(languageFromMenuChoice("KURDI")).toBe("ku");
    expect(languageFromMenuChoice("wolof")).toBe("wo");
    expect(languageFromMenuChoice("ckb")).toBe("ckb");
    expect(languageFromMenuChoice("کوردی (سۆرانی)")).toBe("ckb");
    expect(languageFromMenuChoice("Kreyòl Ayisyen")).toBe("ht");
    expect(languageFromMenuChoice("ქართული")).toBe("ka");
    for (const [i, c] of LANGUAGE_CODES.entries()) {
      expect(languageFromMenuChoice(String(i + 1))).toBe(c);
      expect(languageFromMenuChoice(LANGUAGES[c].nativeName.toUpperCase())).toBe(c);
    }
  });
});

describe("ckb is RTL like ar", () => {
  it("dirOf and RLM line starts", () => {
    expect(dirOf("ckb")).toBe("rtl");
    const t = waText("ckb", "chat_urgent", { name: "Asso", contact: "+33 1 23" });
    expect(t).toContain("⁨Asso⁩");
    for (const line of t.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
    expect(waText("ku", "human_contact", { name: "A", contact: "B" }).startsWith("‏")).toBe(false);
  });
  it("renderLetterReply isolates Latin runs", () => {
    const out = renderLetterReply({
      lang: "ckb",
      text: { title: "نامە", summary: "بچۆ بۆ 12 rue de la Paix", actions: ["بچۆ بۆ 12 rue de la Paix, 75011 Paris"], orientation: ["پەیوەندی بکە"] },
      deadline: null,
      urgency: "low",
      today: "2027-03-02",
      association: { name: "Asso", contact: "+33 1 23" },
    });
    expect(out).toContain("⁨12 rue de la Paix, 75011 Paris⁩");
    for (const line of out.split("\n").filter(Boolean)) expect(line.startsWith("‏")).toBe(true);
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
  it("short = title, date, actions (+ who can help only when urgent); details = summary + who can help; both keep the footer", () => {
    const t = { title: "Courrier de la CAF", summary: "La CAF demande des pièces.", actions: ["Envoyez la pièce"], orientation: ["La CAF de Paris"] };
    const args = { lang: "fr" as const, text: t, deadline: base.deadline, today: base.today, association: base.association };
    const short = renderLetterReply({ ...args, urgency: "medium", part: "short" });
    expect(short).toContain("Courrier de la CAF");
    expect(short).toContain("Envoyez la pièce");
    expect(short).toContain("📅");
    expect(short).not.toContain("La CAF demande des pièces.");
    expect(short).not.toContain("La CAF de Paris");
    expect(short).toContain("ℹ️");
    expect(renderLetterReply({ ...args, urgency: "high", part: "short" })).toContain("La CAF de Paris");
    const details = renderLetterReply({ ...args, urgency: "high", part: "details" });
    expect(details).toContain("La CAF demande des pièces.");
    expect(details).toContain("La CAF de Paris");
    expect(details).not.toContain("Envoyez la pièce");
    expect(details).not.toContain("⚠️");
    expect(details).toContain("ℹ️");
  });

  it("every catalog offers '3 - …' more explanation", () => {
    for (const l of LANGUAGE_CODES) expect(CATALOGS[l].letter_more_details.startsWith("3 - "), l).toBe(true);
  });

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

describe("parseUserDateTime / formatTime (Rendez-vous)", () => {
  it("reads a date and a time typed in many ways", async () => {
    const { parseUserDateTime, formatTime } = await import("../src/index.js");
    expect(parseUserDateTime("14/03/2027 9:30")).toEqual({ date: "2027-03-14", time: "09:30" });
    expect(parseUserDateTime("14-3-27 14h")).toEqual({ date: "2027-03-14", time: "14:00" });
    expect(parseUserDateTime("14.03.2027 à 9h30")).toEqual({ date: "2027-03-14", time: "09:30" });
    expect(parseUserDateTime("١٤/٣/٢٠٢٧ ٩:٣٠")).toEqual({ date: "2027-03-14", time: "09:30" });
    expect(parseUserDateTime("14/03/2027")).toBeNull(); // a time is required
    expect(parseUserDateTime("14/03/2027 25:00")).toBeNull();
    expect(parseUserDateTime("31/02/2027 10:00")).toBeNull();
    expect(formatTime("09:30", "fr")).toBe("09:30");
    expect(formatTime("09:30", "ar")).toBe("٠٩:٣٠ (09:30)");
  });
});
