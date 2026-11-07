// Plain runtime values shared by the API and the back-office, with no zod import: the browser bundle imports
// "@wilson/contracts/values" so it does not ship the schema library (about 90 KB) just to list languages or types.
// The zod schemas built from these lists live next to the other schemas (languages.ts, letters.ts, documents.ts).

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

export const isRtl = (lang: LanguageCode): boolean => LANGUAGES[lang].dir === "rtl";

export const LETTER_TYPES = [
  "prefecture_residence_permit", // titre de séjour, récépissé, convocation préfecture
  "prefecture_removal_order", // OQTF, IRTF, assignation — always urgent
  "ofpra_convocation",
  "ofpra_decision",
  "cnda", // Cour nationale du droit d'asile
  "ofii", // ADA, hébergement, CIR
  "caf",
  "cpam", // assurance maladie, AME, PUMa
  "france_travail",
  "tax", // impots.gouv
  "housing", // bailleur, 115, SIAO
  "court", // tribunal administratif, judiciaire
  "school",
  "bank",
  "other_official",
  "not_official", // ad, private letter, unreadable
] as const;

export const DOCUMENT_TYPES = [
  "attestation_demande_asile", // ADA
  "recepisse", // récépissé de demande de titre
  "titre_de_sejour",
  "autorisation_provisoire_sejour", // APS
  "domiciliation",
  "passport",
  "identity_other",
  "health_insurance", // attestation AME / PUMa / carte vitale
  "caf_attestation",
  "convocation",
  "letter", // a letter saved from "Mon courrier"
  "other",
] as const;

/** What a volunteer can do, for the skills directory and routing hard cases (Compétences screen). */
export const VOLUNTEER_SKILLS = [
  "interpreting", // interprets between French and the languages listed on the profile
  "legal", // legal training (droit des étrangers, juriste, avocat·e)
  "asylum", // knows the asylum procedure (OFPRA, CNDA, Dublin)
  "social_rights", // CAF, CPAM/AME, domiciliation, RSA
  "health", // health professional or knows the care system
  "housing", // 115, SIAO, housing applications
  "forms", // helps fill in forms (ANEF, CAF, AME…)
  "digital", // online accounts, scanning, email
  "driving", // can drive people to appointments
  "accompaniment", // can go with someone to the préfecture, OFII, hospital
] as const;
export type VolunteerSkill = (typeof VOLUNTEER_SKILLS)[number];
