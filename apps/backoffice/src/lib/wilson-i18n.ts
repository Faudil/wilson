/**
 * Thin guard around @wilson/i18n helpers (dates, document type names). If a helper throws (malformed date…),
 * a local Intl-based fallback is used so the UI never crashes.
 * Imported by subpath, not from "@wilson/i18n", so the 28 WhatsApp catalogs stay out of the browser bundle.
 */
import type { DocumentType, LanguageCode } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { formatDate as sharedFormatDate } from "@wilson/i18n/dates";
import { documentTypeName as sharedDocumentTypeName } from "@wilson/i18n/doctypes";

export function formatDate(iso: string, lang: LanguageCode, opts?: { weekday?: boolean }): string {
  try {
    return sharedFormatDate(iso, lang, opts);
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
    return sharedDocumentTypeName(type, lang);
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
