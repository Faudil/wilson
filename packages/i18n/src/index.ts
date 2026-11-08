/**
 * @wilson/i18n — public API (integration point). Implementation owned by batch "i18n".
 * Consumers: apps/api (WhatsApp texts) and apps/backoffice (dates, document type names). Back-office UI catalogs live in apps/backoffice/src/i18n.
 */
import { LANGUAGES, LANGUAGE_CODES, isRtl } from "@wilson/contracts";
import type { LanguageCode, LetterAnalysis, LetterText } from "@wilson/contracts";
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
import { formatDate, normaliseDigits, utcDate } from "./dates.js";
import { buddyTemplate, isRawBuddyParam, type BuddyKey } from "./buddy/index.js";

/** Every WhatsApp message the bot can send. Each key exists in all 28 catalogs (test-enforced). */
export type WaKey =
  | "language_menu" // numbered list of languages in native scripts (same text in every catalog)
  | "language_set" // {language}
  | "welcome"
  | "main_menu" // 1 letter · 2 documents · 3 language · 4 ask a question · 5 sleep/eat/wash today · 6 announcements · 7 practise French · 8 help from a volunteer · 0 human · 9 delete my data
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
  | "places_title" // {date} heading of the list of places posted for today
  | "places_none" // volunteers have not posted places for today
  | "places_115" // emergency shelter: call 115 (closes every list of places)
  | "announcements_ask" // {name} receive announcements? 1 yes 2 no (opt-in, WhatsApp policy)
  | "announcements_ask_on" // {name} already receiving: 1 continue 2 stop
  | "announcements_on" // confirmed; write STOP to stop
  | "announcements_off" // stopped; menu 6 to receive again
  | "broadcast_stop_hint" // under every announcement: write STOP to stop
  // — Rendez-vous with a volunteer (menu 8). {summary} is filled by the API with pre-isolated lines (topic, date, place). —
  | "help_menu" // 1 accompany me · 2 fill in a form · 3 my appointments · 0 back
  | "help_place_menu" // 1–5 = ACCOMPANIMENT_TOPICS order; the option labels double as topic names
  | "help_form_menu" // 1–4 = FORM_TOPICS order
  | "help_ask_datetime"
  | "help_datetime_invalid"
  | "help_ask_city" // 0 = rather not say
  | "help_confirm" // {summary} 1 send 2 cancel
  | "help_request_sent" // sent to volunteers, not guaranteed: go to the appointment anyway
  | "help_slots_intro" // above the "N - date" slot lines
  | "help_slots_other" // "0 - none of these" option line
  | "help_no_slots"
  | "help_consent" // may the volunteer see your saved documents, for this appointment only? 1 yes 2 no
  | "help_accepted" // {name} {summary}
  | "help_reminder" // {name} {summary}; reply 8 then 3 to cancel
  | "help_volunteer_cancelled" // {summary}; open again for other volunteers
  | "help_cancelled_by_us" // {summary}
  | "help_expired" // {summary}; nobody was available
  | "help_list_intro" // above the "N - appointment" lines
  | "help_list_back" // "0 - back" option line
  | "help_list_empty"
  | "help_cancel_confirm" // {summary} 1 yes 2 no
  | "help_cancelled"
  | "guard_slow_down" // flood guard: too many messages, wait a few minutes
  | "guard_held" // flood guard: messages on hold until a volunteer checks
  | "guard_released" // flood guard: a volunteer released the number
  | "nearby_hint" // after the list of the day: share your location (📎 then 📍) or write an address/station
  | "nearby_title" // {distance} heading of the places nearest to a shared location
  | "nearby_none" // nothing open found near that point today (the 115 line follows)
  | "nearby_not_found" // typed address not found: add the city, or share your location
  | "nearby_water" // label of an unnamed drinking-water point
  | "nearby_toilets" // label of unnamed public toilets
  | "nearby_shower" // label of an unnamed public shower
  | "nearby_pharmacy" // label of an unnamed pharmacy
  | "footer"; // {name} {contact} — appended to every reply, never optional

export type Params = Record<string, string | number>;

export { LANGUAGE_MENU, LANGUAGE_MENU_HEADER } from "./menu.js";
// Dates and document type names live in their own modules so the back-office can import them without the WhatsApp catalogs.
export { formatDate, formatTime, normaliseDigits, parseUserDate, parseUserDateTime } from "./dates.js";
export { documentTypeName } from "./doctypes.js";

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

function fill(template: string, params: Params, raw: (k: string) => boolean = (k) => RAW_PARAMS.has(k)): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in params ? (typeof params[k] === "number" || raw(k) ? String(params[k]) : isolate(String(params[k]))) : whole));
}

function renderKey(lang: LanguageCode, key: WaKey, params: Params = {}): string {
  return fill(CATALOGS[lang][key], params);
}

/**
 * Name of a numbered option in a menu text ("2 - OFII" → "OFII"): the Rendez-vous topics are named by their menu
 * labels, so a topic always reads the same in the menu and in later messages.
 */
export function menuOptionLabel(lang: LanguageCode, key: WaKey, option: number): string {
  const line = CATALOGS[lang][key].split("\n").find((l) => l.trim().startsWith(`${option} - `));
  return line ? line.trim().slice(`${option} - `.length).trim() : String(option);
}

/** Render a WhatsApp message. Every placeholder value is bidi-isolated automatically; RTL languages get a RLM at each line start. */
export function waText(lang: LanguageCode, key: WaKey, params: Params = {}): string {
  const out = renderKey(lang, key, params);
  return isRtl(lang) && key !== "language_menu" ? rtlLines(out) : out;
}

export { BUDDY_CATALOGS, type BuddyKey } from "./buddy/index.js";

/** Render a French-practice-buddies message (same rules as waText). `how` is catalog text and is not isolated. */
export function buddyText(lang: LanguageCode, key: BuddyKey, params: Params = {}): string {
  const out = fill(buddyTemplate(lang, key), params, isRawBuddyParam);
  return isRtl(lang) ? rtlLines(out) : out;
}

/** "By phone call." / "Meeting place: …", to pass as the `how` param of buddy_proposal and buddy_reminder. */
export function buddyHow(lang: LanguageCode, mode: "call" | "meet", place: string | null): string {
  return mode === "call" ? buddyTemplate(lang, "buddy_how_call") : fill(buddyTemplate(lang, "buddy_how_meet"), { place: place || "—" });
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
