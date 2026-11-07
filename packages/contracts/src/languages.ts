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
  // — added 2026-11: main countries of origin of people seeking protection in France —
  ru: { nativeName: "Русский", dir: "ltr", intlLocale: "ru-RU", script: "Cyrl" },
  es: { nativeName: "Español", dir: "ltr", intlLocale: "es-ES", script: "Latn" },
  pt: { nativeName: "Português", dir: "ltr", intlLocale: "pt-PT", script: "Latn" },
  tr: { nativeName: "Türkçe", dir: "ltr", intlLocale: "tr-TR", script: "Latn" },
  ku: { nativeName: "Kurdî (Kurmancî)", dir: "ltr", intlLocale: "ku", script: "Latn" },
  ckb: { nativeName: "کوردی (سۆرانی)", dir: "rtl", intlLocale: "ckb-IQ", script: "Arab" },
  bn: { nativeName: "বাংলা", dir: "ltr", intlLocale: "bn-BD", script: "Beng" },
  ta: { nativeName: "தமிழ்", dir: "ltr", intlLocale: "ta-LK", script: "Taml" },
  ka: { nativeName: "ქართული", dir: "ltr", intlLocale: "ka-GE", script: "Geor" },
  hy: { nativeName: "Հայերեն", dir: "ltr", intlLocale: "hy-AM", script: "Armn" },
  sq: { nativeName: "Shqip", dir: "ltr", intlLocale: "sq-AL", script: "Latn" },
  ro: { nativeName: "Română", dir: "ltr", intlLocale: "ro-RO", script: "Latn" },
  ht: { nativeName: "Kreyòl ayisyen", dir: "ltr", intlLocale: "ht", script: "Latn" },
  wo: { nativeName: "Wolof", dir: "ltr", intlLocale: "wo-SN", script: "Latn" },
  ff: { nativeName: "Pulaar", dir: "ltr", intlLocale: "ff-SN", script: "Latn" },
  bm: { nativeName: "Bamanankan", dir: "ltr", intlLocale: "bm-ML", script: "Latn" },
  ln: { nativeName: "Lingála", dir: "ltr", intlLocale: "ln-CD", script: "Latn" },
  sw: { nativeName: "Kiswahili", dir: "ltr", intlLocale: "sw-KE", script: "Latn" },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as [LanguageCode, ...LanguageCode[]];
export const LanguageSchema = z.enum(LANGUAGE_CODES);

export const isRtl = (lang: LanguageCode): boolean => LANGUAGES[lang].dir === "rtl";
