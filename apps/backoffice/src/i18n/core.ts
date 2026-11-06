import type { LanguageCode } from "@wilson/contracts";
import ar from "./ar.json";
import en from "./en.json";
import fr from "./fr.json";

export type MessageKey = keyof typeof fr;
export type Catalog = Record<MessageKey, string>;
export type Params = Record<string, string | number>;

export const CATALOGS: Partial<Record<LanguageCode, Catalog>> = { fr, en, ar };
/** UI languages that have a full catalog; the picker offers these. */
export const UI_LANGUAGES = ["fr", "en", "ar"] as const satisfies readonly LanguageCode[];
export const DEFAULT_LANGUAGE: LanguageCode = "fr";

/** Replace `{name}` placeholders. Unknown placeholders are left visible so they get noticed. No concatenation in callers. */
export function format(message: string, params?: Params): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Lookup with fallback: requested language, then English, then French. */
export function translate(lang: LanguageCode, key: MessageKey, params?: Params): string {
  const raw = CATALOGS[lang]?.[key] ?? en[key] ?? fr[key] ?? key;
  return format(raw, params);
}
