// Calendar dates in every supported language (no catalogs here, so the back-office can import it alone via "@wilson/i18n/dates").
import { LANGUAGES, type LanguageCode } from "@wilson/contracts/values";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcDate(iso: string): Date {
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

export function normaliseDigits(s: string): string {
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

/** "09:30"; languages with native digits get both, like dates: "٠٩:٣٠ (09:30)". */
export function formatTime(hhmm: string, lang: LanguageCode): string {
  const native = NATIVE_DIGITS[lang];
  return native ? `${withDigits(hhmm, native)} (${hhmm})` : hhmm;
}

/**
 * A date and a time typed by the person: "14/03/2027 9:30", "14-3-27 14h", "14.03.2027 à 9h30", "١٤/٣/٢٠٢٧ ٩:٣٠".
 * Anything that is not a digit may sit between the date and the time (à, at, saat…). Returns the calendar date and
 * "HH:MM" (local time, Europe/Paris for the caller), or null.
 */
export function parseUserDateTime(input: string): { date: string; time: string } | null {
  const s = normaliseDigits(input).replace(/[‎‏⁦-⁩]/g, "").trim();
  const m = /^(\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*(?:\d{4}|\d{2}))\D+?(\d{1,2})\s*(?:[h:.]\s*(\d{2})?)?\s*\D{0,6}$/i.exec(s);
  if (!m) return null;
  const date = parseUserDate(m[1]!);
  const h = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  if (!date || h > 23 || min > 59) return null;
  return { date, time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}
