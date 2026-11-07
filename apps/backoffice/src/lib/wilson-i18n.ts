/**
 * Thin guard around @wilson/i18n helpers (dates, document type names). If the shared package does not
 * implement a helper (yet), a local Intl-based fallback is used so the UI never crashes.
 */
import { LANGUAGES, type DocumentType, type LanguageCode } from "@wilson/contracts";
import * as shared from "@wilson/i18n";

type Shared = {
  formatDate?: (iso: string, lang: LanguageCode, opts?: { weekday?: boolean }) => string;
  documentTypeName?: (type: DocumentType, lang: LanguageCode) => string;
};
const impl = shared as unknown as Shared;

export function formatDate(iso: string, lang: LanguageCode, opts?: { weekday?: boolean }): string {
  try {
    if (typeof impl.formatDate === "function") return impl.formatDate(iso, lang, opts);
  } catch {
    /* fall through */
  }
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  try {
    return new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      weekday: opts?.weekday ? "long" : undefined,
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso;
  }
}

export function documentTypeName(type: DocumentType, lang: LanguageCode): string {
  try {
    if (typeof impl.documentTypeName === "function") return impl.documentTypeName(type, lang);
  } catch {
    /* fall through */
  }
  return type.replace(/_/g, " ");
}

/** Date + time of a timestamp for the volunteer (UI language, Paris time). */
export function formatDateTime(timestamp: string, lang: LanguageCode): string {
  try {
    return new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}
