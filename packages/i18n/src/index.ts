/**
 * @wilson/i18n — public API (integration point). Implementation owned by batch "i18n".
 * Consumers: apps/api (WhatsApp texts) and apps/backoffice (dates, document type names). Back-office UI catalogs live in apps/backoffice/src/i18n.
 */
import type { LanguageCode, LetterAnalysis, LetterText, DocumentType } from "@wilson/contracts";

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
  | "footer"; // {name} {contact} — appended to every reply, never optional

export type Params = Record<string, string | number>;

/** Render a WhatsApp message. Every placeholder value is bidi-isolated automatically. */
export declare function waText(lang: LanguageCode, key: WaKey, params?: Params): string;

/** Wrap a fragment with FSI (U+2068) … PDI (U+2069) so it keeps its own direction inside any paragraph. */
export declare function isolate(fragment: string): string;

/**
 * Written-out date, never DD/MM. Locale form (native digits where the locale uses them) followed by the
 * Western-digit form when they differ, e.g. ar: "١٤ مارس ٢٠٢٧ (14 مارس 2027)". `iso` is YYYY-MM-DD.
 */
export declare function formatDate(iso: string, lang: LanguageCode, opts?: { weekday?: boolean }): string;

/** Lenient parse of a date typed by a user (14/03/2027, 14-3-27, 14.03.2027, Arabic-Indic or Persian digits). DD/MM order. */
export declare function parseUserDate(input: string): string | null;

/** Localised name of a document type, e.g. "récépissé" in fr. */
export declare function documentTypeName(type: DocumentType, lang: LanguageCode): string;

/**
 * The full WhatsApp reply for an analysed letter: title, summary, actions, deadline (formatted, with days left),
 * orientation, then the mandatory footer. Plain text, WhatsApp *bold* allowed, ≤ 4096 chars.
 */
export declare function renderLetterReply(input: {
  lang: LanguageCode;
  text: LetterText;
  deadline: LetterAnalysis["deadline"];
  urgency: LetterAnalysis["urgency"];
  today: string;
  association: { name: string; contact: string };
}): string;

