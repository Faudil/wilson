import { z } from "zod";

/**
 * Languages supported from day one. Order = order shown in the WhatsApp language menu.
 * `dir` drives `dir="rtl"` in the back-office and Unicode isolation in WhatsApp text.
 */
export const LANGUAGES = {
  fr: { nativeName: "Français", dir: "ltr", intlLocale: "fr-FR", script: "Latn" },
  en: { nativeName: "English", dir: "ltr", intlLocale: "en-GB", script: "Latn" },
  ar: { nativeName: "العربية", dir: "rtl", intlLocale: "ar", script: "Arab" },
  fa: { nativeName: "دری", dir: "rtl", intlLocale: "fa-AF", script: "Arab" },
  ps: { nativeName: "پښتو", dir: "rtl", intlLocale: "ps-AF", script: "Arab" },
  ur: { nativeName: "اردو", dir: "rtl", intlLocale: "ur-PK", script: "Arab" },
  uk: { nativeName: "Українська", dir: "ltr", intlLocale: "uk-UA", script: "Cyrl" },
  ti: { nativeName: "ትግርኛ", dir: "ltr", intlLocale: "ti-ER", script: "Ethi" },
  so: { nativeName: "Soomaali", dir: "ltr", intlLocale: "so-SO", script: "Latn" },
  am: { nativeName: "አማርኛ", dir: "ltr", intlLocale: "am-ET", script: "Ethi" },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as [LanguageCode, ...LanguageCode[]];
export const LanguageSchema = z.enum(LANGUAGE_CODES);

export const isRtl = (lang: LanguageCode): boolean => LANGUAGES[lang].dir === "rtl";
