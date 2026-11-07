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
import { ru } from "./catalogs/ru.js";
import { es } from "./catalogs/es.js";
import { pt } from "./catalogs/pt.js";
import { tr } from "./catalogs/tr.js";
import { ku } from "./catalogs/ku.js";
import { ckb } from "./catalogs/ckb.js";
import { bn } from "./catalogs/bn.js";
import { ta } from "./catalogs/ta.js";
import { ka } from "./catalogs/ka.js";
import { hy } from "./catalogs/hy.js";
import { sq } from "./catalogs/sq.js";
import { ro } from "./catalogs/ro.js";
import { ht } from "./catalogs/ht.js";
import { wo } from "./catalogs/wo.js";
import { ff } from "./catalogs/ff.js";
import { bm } from "./catalogs/bm.js";
import { ln } from "./catalogs/ln.js";
import { sw } from "./catalogs/sw.js";
import { DOCUMENT_TYPE_NAMES } from "./doctypes.js";

/** Every WhatsApp message the bot can send. Each key exists in all 28 catalogs (test-enforced). */
export type WaKey =
  | "language_menu" // numbered list of languages in native scripts (same text in every catalog)
  | "language_set" // {language}
  | "welcome"
  | "main_menu" // 1 letter · 2 documents · 3 language · 4 ask a question · 0 human · 9 delete my data
  | "not_understood"
  | "human_contact" // {name} {contact}
  | "letter_ask_photo"
  | "letter_received" // ack, a volunteer will check
  | "letter_unsupported_media"
  | "letter_rejected" // a volunteer will contact you
  | "letter_offer_save" // 1 yes 2 no
  | "letter_saved"
  | "letter_not_saved"
  | "letter_more_details" // "3 - More explanation": extra option under letter_offer_save (summary + who can help)
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
  | "chat_intro" // you can ask a question in your own words; a volunteer checks answers (review mode)
  | "chat_pending" // your question was received, a volunteer will check the answer before sending
  | "chat_handoff" // a volunteer will answer you personally
  | "chat_urgent" // emergency numbers: 115 (shelter), 15 (SAMU), 17 (police), 112, 119 (child); association contact
  | "chat_voice_unsupported" // please write your message, voice notes are not supported yet
  | "chat_letter_redirect" // to explain a letter, send a photo (or menu 1)
  | "chat_document_redirect" // for your documents, reply 2
  | "footer"; // {name} {contact} — appended to every reply, never optional

export type Params = Record<string, string | number>;

export { LANGUAGE_MENU, LANGUAGE_MENU_HEADER } from "./menu.js";

export const CATALOGS: Record<LanguageCode, Record<WaKey, string>> = {
  fr, en, ar, fa, ps, ur, uk, ti, so, am,
  ru, es, pt, tr, ku, ckb, bn, ta, ka, hy, sq, ro, ht, wo, ff, bm, ln, sw,
};

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
const NATIVE_DIGITS: Partial<Record<LanguageCode, string>> = { ar: "arab", fa: "arabext", ps: "arabext", ckb: "arab", bn: "beng" };

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
 * Chromium lacks CLDR data for ti and so (and am differs between engines), and ICU data is thin or inconsistent for
 * hy, ka, sq, ta, ht, wo, ff, bm, ln, sw, ku and ckb: month and weekday names are built in so Node and browsers print the same text. Order is fixed: [weekday] day month year. Weekday index 0 = Sunday.
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
  ka: {
    months: "იანვარი თებერვალი მარტი აპრილი მაისი ივნისი ივლისი აგვისტო სექტემბერი ოქტომბერი ნოემბერი დეკემბერი".split(" "),
    days: "კვირა ორშაბათი სამშაბათი ოთხშაბათი ხუთშაბათი პარასკევი შაბათი".split(" "),
  },
  sq: {
    months: "janar shkurt mars prill maj qershor korrik gusht shtator tetor nëntor dhjetor".split(" "),
    days: ["e diel", "e hënë", "e martë", "e mërkurë", "e enjte", "e premte", "e shtunë"],
  },
  ta: {
    months: "ஜனவரி பிப்ரவரி மார்ச் ஏப்ரல் மே ஜூன் ஜூலை ஆகஸ்ட் செப்டம்பர் அக்டோபர் நவம்பர் டிசம்பர்".split(" "),
    days: "ஞாயிறு திங்கள் செவ்வாய் புதன் வியாழன் வெள்ளி சனி".split(" "),
  },
  hy: {
    months: "հունվարի փետրվարի մարտի ապրիլի մայիսի հունիսի հուլիսի օգոստոսի սեպտեմբերի հոկտեմբերի նոյեմբերի դեկտեմբերի".split(" "),
    days: "կիրակի երկուշաբթի երեքշաբթի չորեքշաբթի հինգշաբթի ուրբաթ շաբաթ".split(" "),
  },
  ht: {
    months: "janvye fevriye mas avril me jen jiyè out septanm oktòb novanm desanm".split(" "),
    days: "dimanch lendi madi mèkredi jedi vandredi samdi".split(" "),
  },
  wo: {
    months: "Samwiyee Fewriyee Mars Awril Me Suwe Sulet Ut Settembar Oktoobar Nowembar Desembar".split(" "),
    days: "Dibéer Altine Talaata Àllarba Alxamis Àjjuma Gaawu".split(" "),
  },
  ff: {
    months: "siilo colte mbooy seeɗto duujal korse morso juko siilto yarkomaa jolal bowte".split(" "),
    days: "dewo aaɓnde mawbaare njeslaare naasaande mawnde hoore-biir".split(" "),
  },
  bm: {
    months: "zanwuyekalo feburuyekalo marisikalo awirilikalo mɛkalo zuwɛnkalo zuluyekalo utikalo sɛtanburukalo ɔkutɔburukalo nowanburukalo desanburukalo".split(" "),
    days: "kari ntɛnɛn tarata araba alamisa juma sibiri".split(" "),
  },
  ln: {
    months: ["sánzá ya yambo", "sánzá ya míbalé", "sánzá ya mísáto", "sánzá ya mínei", "sánzá ya mítáno", "sánzá ya motóba", "sánzá ya nsambo", "sánzá ya mwambe", "sánzá ya libwa", "sánzá ya zómi", "sánzá ya zómi na mɔ̌kɔ́", "sánzá ya zómi na míbalé"],
    days: ["eyenga", "mokɔlɔ mwa yambo", "mokɔlɔ mwa míbalé", "mokɔlɔ mwa mísáto", "mokɔlɔ ya mínéi", "mokɔlɔ ya mítáno", "mpɔ́sɔ"],
  },
  sw: {
    months: "Januari Februari Machi Aprili Mei Juni Julai Agosti Septemba Oktoba Novemba Desemba".split(" "),
    days: "Jumapili Jumatatu Jumanne Jumatano Alhamisi Ijumaa Jumamosi".split(" "),
  },
  ku: {
    months: "Çile Sibat Adar Nîsan Gulan Hezîran Tîrmeh Tebax Îlon Cotmeh Mijdar Kanûn".split(" "),
    days: "yekşem duşem sêşem çarşem pêncşem în şemî".split(" "),
  },
  ckb: {
    months: ["کانوونی دووەم", "شوبات", "ئازار", "نیسان", "ئایار", "حوزەیران", "تەممووز", "ئاب", "ئەیلوول", "تشرینی یەکەم", "تشرینی دووەم", "کانوونی یەکەم"],
    days: "یەکشەممە دووشەممە سێشەممە چوارشەممە پێنجشەممە هەینی شەممە".split(" "),
  },
};

const DIGIT_ZERO: Record<string, number> = { arab: 0x0660, arabext: 0x06f0, beng: 0x09e6 };
function withDigits(s: string, numberingSystem: string): string {
  const z = DIGIT_ZERO[numberingSystem];
  return z === undefined ? s : s.replace(/\d/g, (c) => String.fromCharCode(z + Number(c)));
}

function formatOne(date: Date, lang: LanguageCode, weekday: boolean, numberingSystem: string): string {
  const table = NAME_TABLES[lang];
  if (table) {
    const parts = [withDigits(String(date.getUTCDate()), numberingSystem), table.months[date.getUTCMonth()]!, withDigits(String(date.getUTCFullYear()), numberingSystem)];
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
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6));
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

/** Lowercase, accent-insensitive key ("Français" -> "francais"). */
function fold(x: string): string {
  return x.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** "1".."28" (Western, Arabic-Indic, Persian or Bengali digits), an ISO code, or a native name (case/accent-insensitive). */
export function languageFromMenuChoice(input: string): LanguageCode | null {
  const raw = normaliseDigits(input).replace(/[\u200e\u200f\u2066-\u2069]/g, "").trim();
  const s = raw.replace(/[.)\-]+$/, "").trim();
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= LANGUAGE_CODES.length ? LANGUAGE_CODES[n - 1]! : null;
  }
  const low = s.toLocaleLowerCase();
  const key = fold(s);
  const rawKey = fold(raw);
  for (const c of LANGUAGE_CODES) {
    const name = LANGUAGES[c].nativeName;
    const short = name.replace(/\s*\(.*\)\s*$/, ""); // "Kurdî (Kurmancî)" -> "Kurdî"
    if (low === c || key === fold(name) || rawKey === fold(name) || key === fold(short)) return c;
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
  /**
   * full = everything in one message (back-office preview of the French).
   * short = what the person gets first: urgency, title, date, what to do, and who can help when urgent (+ footer).
   * details = sent on request ("3 - More explanation"): title, what the letter says, who can help (+ footer).
   */
  part?: "full" | "short" | "details";
}): string {
  const { lang, text, deadline, urgency, today, association } = input;
  const part = input.part ?? "full";
  const rtl = isRtl(lang);
  const prep = (s: string): string => (rtl ? isolateLatinRuns(s) : s);

  const build = (summary: string): { body: string; footer: string } => {
    const blocks: string[] = [];
    const title = `*${prep(text.title.replace(/\*/g, ""))}*`;
    const actions = text.actions.length > 0 ? [renderKey(lang, "letter_actions_title"), ...text.actions.map((a, i) => `${i + 1}. ${prep(a)}`)].join("\n") : null;
    let date: string | null = null;
    if (deadline) {
      const n = daysBetween(today, deadline.date);
      const relative =
        n < 0 ? renderKey(lang, "deadline_passed") : n === 0 ? renderKey(lang, "deadline_today") : n === 1 ? renderKey(lang, "deadline_tomorrow") : renderKey(lang, "deadline_in_days", { n });
      date = renderKey(lang, "deadline_line", { date: formatDate(deadline.date, lang, { weekday: true }), relative });
    }
    const orientation = [renderKey(lang, "letter_orientation_title"), ...text.orientation.map((o) => `- ${prep(o)}`)].join("\n");
    if (part !== "details" && urgency === "high") blocks.push(renderKey(lang, "letter_urgent"));
    blocks.push(title);
    if (part === "short") {
      if (date) blocks.push(date);
      if (actions) blocks.push(actions);
      // Urgent letters: who can help belongs in the first message, not behind "more explanation".
      if (urgency === "high") blocks.push(orientation);
    } else if (part === "details") {
      blocks.push(prep(summary), orientation);
    } else {
      blocks.push(prep(summary));
      if (actions) blocks.push(actions);
      if (date) blocks.push(date);
      blocks.push(orientation);
    }
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
