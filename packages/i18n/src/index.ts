/**
 * @wilson/i18n — public API (integration point). Implementation owned by batch "i18n".
 * Consumers: apps/api (WhatsApp texts) and apps/backoffice (dates, document type names). Back-office UI catalogs live in apps/backoffice/src/i18n.
 */
import { LANGUAGES, LANGUAGE_CODES, isRtl } from "@wilson/contracts";
import type { LanguageCode, LetterAnalysis, LetterText, DocumentType } from "@wilson/contracts";
import { fr } from "./catalogs/fr.js";
import { en } from "./catalogs/en.js";
import { ar } from "./catalogs/ar.js";
import { fa } from "./catalogs/fa.js";
import { ps } from "./catalogs/ps.js";
import { ur } from "./catalogs/ur.js";
import { uk } from "./catalogs/uk.js";
import { ti } from "./catalogs/ti.js";
import { so } from "./catalogs/so.js";
import { am } from "./catalogs/am.js";
import { DOCUMENT_TYPE_NAMES } from "./doctypes.js";

/** Every WhatsApp message the bot can send. Each key exists in all 10 catalogs (test-enforced). */
export type WaKey =
  | "language_menu" // numbered list of languages in native scripts (same text in every catalog)
  | "language_set" // {language}
  | "welcome"
  | "main_menu" // 1 letter · 2 documents · 3 language · 0 human · 9 delete my data
  | "not_understood"
  | "human_contact" // {name} {contact}
  | "letter_ask_photo"
  | "letter_received" // ack, a volunteer will check
  | "letter_unsupported_media"
  | "letter_rejected" // a volunteer will contact you
  | "letter_offer_save" // 1 yes 2 no
  | "letter_saved"
  | "letter_not_saved"
  | "document_ask_file"
  | "document_analyzing"
  | "document_confirm" // {type} {date}  1 correct 2 change date
  | "document_confirm_no_date" // {type} please type the expiry date or 0 if none
  | "document_enter_date"
  | "document_date_invalid"
  | "document_saved" // {type} {date}
  | "document_list" // {list}
  | "document_list_empty"
  | "document_expired" // {type} {date}
  | "reminder_d30" // {type} {date}
  | "reminder_d7" // {type} {date}
  | "delete_confirm" // 1 yes 2 no
  | "delete_done"
  | "letter_actions_title" // heading above the numbered actions
  | "letter_orientation_title" // heading above the orientation lines
  | "deadline_line" // {date} {relative}
  | "deadline_in_days" // {n} (n >= 2)
  | "deadline_tomorrow"
  | "deadline_today"
  | "deadline_passed"
  | "letter_urgent" // shown first when urgency is high
  | "footer"; // {name} {contact} — appended to every reply, never optional

export type Params = Record<string, string | number>;

export { LANGUAGE_MENU } from "./menu.js";

export const CATALOGS: Record<LanguageCode, Record<WaKey, string>> = { fr, en, ar, fa, ps, ur, uk, ti, so, am };

const FSI = "⁨";
const PDI = "⁩";
const RLM = "‏";

/** "ltr" | "rtl" for a language. */
export function dirOf(lang: LanguageCode): "ltr" | "rtl" {
  return LANGUAGES[lang].dir;
}

export function isolate(fragment: string): string {
  if (fragment.startsWith(FSI) && fragment.endsWith(PDI)) return fragment;
  return FSI + fragment + PDI;
}

/** In RTL text, wrap every Latin/digit run (addresses, references, phone numbers) with FSI..PDI. */
function isolateLatinRuns(text: string): string {
  if (text.includes(FSI)) return text; // already isolated by the producer
  return text.replace(/[\p{Script=Latin}\d](?:[\p{Script=Latin}\d'’.\-\/°]|(?:,\s?|\s)(?=[\p{Script=Latin}\d]))*/gu, (m) => isolate(m));
}

/** Start every non-empty line with RLM so lines beginning with a digit/emoji/Latin word stay RTL in WhatsApp. */
function rtlLines(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.length > 0 && !l.startsWith(RLM) ? RLM + l : l))
    .join("\n");
}

/** Params that are already localised catalog text (not user data): not isolated. */
const RAW_PARAMS = new Set(["relative"]);

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in params ? (typeof params[k] === "number" || RAW_PARAMS.has(k) ? String(params[k]) : isolate(String(params[k]))) : whole));
}

function renderKey(lang: LanguageCode, key: WaKey, params: Params = {}): string {
  return fill(CATALOGS[lang][key], params);
}

/** Render a WhatsApp message. Every placeholder value is bidi-isolated automatically; RTL languages get a RLM at each line start. */
export function waText(lang: LanguageCode, key: WaKey, params: Params = {}): string {
  const out = renderKey(lang, key, params);
  return isRtl(lang) && key !== "language_menu" ? rtlLines(out) : out;
}

// ---------------------------------------------------------------------------------------------- dates

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDate(iso: string): Date {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw new RangeError(`Invalid calendar date: ${iso}`);
  return date;
}

/** Locales whose native digits we show (ICU default may differ: Node 22 gives latn for "ar"). */
const NATIVE_DIGITS: Partial<Record<LanguageCode, string>> = { ar: "arab", fa: "arabext", ps: "arabext" };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, weekday: boolean, numberingSystem: string): Intl.DateTimeFormat {
  const k = `${locale}|${weekday}|${numberingSystem}`;
  let f = fmtCache.get(k);
  if (!f) {
    // calendar gregory is forced: fa-AF and ps-AF default to the Persian calendar in ICU.
    f = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(weekday ? { weekday: "long" as const } : {}),
      timeZone: "UTC",
      calendar: "gregory",
      numberingSystem,
    });
    fmtCache.set(k, f);
  }
  return f;
}

/**
 * Chromium lacks CLDR data for ti and so (and am differs between engines): month and weekday names are built in so
 * Node and browsers print the same text. Order is fixed: [weekday] day month year. Weekday index 0 = Sunday.
 */
const NAME_TABLES: Partial<Record<LanguageCode, { months: string[]; days: string[] }>> = {
  am: {
    months: "ጃንዋሪ ፌብሩዋሪ ማርች ኤፕሪል ሜይ ጁን ጁላይ ኦገስት ሴፕቴምበር ኦክቶበር ኖቬምበር ዲሴምበር".split(" "),
    days: "እሑድ ሰኞ ማክሰኞ ረቡዕ ሐሙስ ዓርብ ቅዳሜ".split(" "),
  },
  ti: {
    months: "ጥሪ ለካቲት መጋቢት ሚያዝያ ግንቦት ሰነ ሓምለ ነሓሰ መስከረም ጥቅምቲ ሕዳር ታሕሳስ".split(" "),
    days: "ሰንበት ሰኑይ ሰሉስ ረቡዕ ሓሙስ ዓርቢ ቀዳም".split(" "),
  },
  so: {
    months: "Janaayo Febraayo Maarso Abriil May Juun Luuliyo Ogost Sebtembar Oktoobar Nofembar Desembar".split(" "),
    days: "Axad Isniin Salaasa Arbaco Khamiis Jimce Sabti".split(" "),
  },
};

function formatOne(date: Date, lang: LanguageCode, weekday: boolean, numberingSystem: string): string {
  const table = NAME_TABLES[lang];
  if (table) {
    const parts = [String(date.getUTCDate()), table.months[date.getUTCMonth()]!, String(date.getUTCFullYear())];
    return (weekday ? [table.days[date.getUTCDay()]!, ...parts] : parts).join(" ");
  }
  const f = dtf(LANGUAGES[lang].intlLocale, weekday, numberingSystem);
  if (lang === "ps") {
    // ICU's Pashto pattern ("يونۍ د ۲۰۲۷ د مارچ ۱۴") is hard to read: compose weekday, day, month, year ourselves.
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return [p.weekday, p.day, p.month, p.year].filter(Boolean).join(" ");
  }
  return f.format(date);
}

export function formatDate(iso: string, lang: LanguageCode, opts: { weekday?: boolean } = {}): string {
  const date = utcDate(iso);
  const weekday = opts.weekday === true;
  const native = NATIVE_DIGITS[lang];
  const main = formatOne(date, lang, weekday, native ?? "latn");
  if (!native) return main;
  const latin = formatOne(date, lang, weekday, "latn");
  return latin === main ? main : `${main} (${latin})`;
}

function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

export function parseUserDate(input: string): string | null {
  const s = normaliseDigits(input).replace(/[‎‏⁦-⁩]/g, "").trim();
  const m = /^(\d{1,2})\s*[\/\-.\s]\s*(\d{1,2})\s*[\/\-.\s]\s*(\d{4}|\d{2})$/.exec(s);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function documentTypeName(type: DocumentType, lang: LanguageCode): string {
  return DOCUMENT_TYPE_NAMES[lang][type];
}

/** "1".."10" (Latin, Arabic-Indic or Persian digits), a language code, or a native name. */
export function languageFromMenuChoice(input: string): LanguageCode | null {
  const s = normaliseDigits(input).replace(/[‎‏⁦-⁩]/g, "").trim().replace(/[.)\-]+$/, "").trim();
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= LANGUAGE_CODES.length ? LANGUAGE_CODES[n - 1]! : null;
  }
  const low = s.toLocaleLowerCase();
  for (const c of LANGUAGE_CODES) {
    if (low === c || low === LANGUAGES[c].nativeName.toLocaleLowerCase()) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------- letter reply

const MAX_LEN = 4096;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDate(toIso).getTime() - utcDate(fromIso).getTime()) / 86_400_000);
}

export function renderLetterReply(input: {
  lang: LanguageCode;
  text: LetterText;
  deadline: LetterAnalysis["deadline"];
  urgency: LetterAnalysis["urgency"];
  today: string;
  association: { name: string; contact: string };
}): string {
  const { lang, text, deadline, urgency, today, association } = input;
  const rtl = isRtl(lang);
  const prep = (s: string): string => (rtl ? isolateLatinRuns(s) : s);

  const build = (summary: string): { body: string; footer: string } => {
    const blocks: string[] = [];
    if (urgency === "high") blocks.push(renderKey(lang, "letter_urgent"));
    blocks.push(`*${prep(text.title.replace(/\*/g, ""))}*`);
    blocks.push(prep(summary));
    if (text.actions.length > 0) {
      blocks.push([renderKey(lang, "letter_actions_title"), ...text.actions.map((a, i) => `${i + 1}. ${prep(a)}`)].join("\n"));
    }
    if (deadline) {
      const n = daysBetween(today, deadline.date);
      const relative =
        n < 0 ? renderKey(lang, "deadline_passed") : n === 0 ? renderKey(lang, "deadline_today") : n === 1 ? renderKey(lang, "deadline_tomorrow") : renderKey(lang, "deadline_in_days", { n });
      blocks.push(renderKey(lang, "deadline_line", { date: formatDate(deadline.date, lang, { weekday: true }), relative }));
    }
    blocks.push([renderKey(lang, "letter_orientation_title"), ...text.orientation.map((o) => `- ${prep(o)}`)].join("\n"));
    const body = blocks.join("\n\n");
    return { body, footer: renderKey(lang, "footer", association) };
  };
  const join = (r: { body: string; footer: string }): string => {
    const out = `${r.body}\n\n${r.footer}`;
    return rtl ? rtlLines(out) : out;
  };

  let summary = text.summary;
  let out = join(build(summary));
  while (out.length > MAX_LEN && summary.length > 20) {
    const excess = out.length - MAX_LEN;
    summary = summary.slice(0, Math.max(10, summary.length - excess - 5)).trimEnd() + "…";
    out = join(build(summary));
  }
  if (out.length > MAX_LEN) {
    // Last resort: cut the body, never the footer.
    const r = build(summary);
    const room = MAX_LEN - r.footer.length - 40; // margin for separators and RLMs
    out = join({ body: r.body.slice(0, Math.max(0, room)).trimEnd() + "…", footer: r.footer });
  }
  return out;
}
