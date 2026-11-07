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

/**
 * Fine-grained permissions. The server checks permissions, never roles; roles are only named bundles
 * (ROLE_PERMISSIONS below), and admins can grant or revoke single permissions per volunteer on top of the bundle.
 * Plain list here so the back-office permission editor can show them without zod.
 */
export const PERMISSIONS = [
  "letters.review", // see queue, read analysis, edit, approve, reject
  "letters.view_photo",
  "beneficiaries.view",
  "beneficiaries.edit", // change language
  "documents.view_metadata",
  "documents.view_file",
  "documents.edit", // fix type / expiry, archive
  "sandbox.use",
  "volunteers.manage", // approve signups, roles, per-person permissions, disable accounts
  "audit.view",
  "knowledge.view", // browse sources, test search
  "knowledge.manage", // trigger a sync
  "conversations.view", // read chatbot conversations
  "conversations.reply", // approve/reject drafts, reply, resolve
  "usage.manage", // see Claude API usage and costs, set the monthly budget
  "places.view", // see the places posted for today (shelter, food, showers…)
  "places.manage", // post, edit and remove places: they reach beneficiaries without review
  "broadcasts.view", // see announcements and their delivery numbers
  "broadcasts.create", // write announcement drafts (nothing is sent)
  "broadcasts.approve", // approve and send an announcement (costs money outside the 24 h window), cancel any draft
  "notes.view", // read case notes and follow-up tasks on a person, see "my tasks"
  "notes.write", // add notes and tasks, edit/delete own notes, tick tasks done (needs notes.view to see them)
  "notes.moderate", // edit or delete anyone's note or task text
  "tasks.assign", // give a task to another volunteer (without it: only to yourself or to nobody)
  "skills.view", // browse the skills directory and the "who can help" suggestions
  "skills.edit_own", // fill in your own languages and skills
  "buddies.be_buddy", // French practice: own buddy profile, take requests for oneself, see and message one's own buddies
  "buddies.manage", // French practice: see all requests and pairings, propose any buddy, end any pairing (no messages, no numbers)
  "buddies.reports", // French practice: read and handle reports (incl. the reported pairing's messages), resume or end it
  // — Rendez-vous (accompaniment to appointments, form-filling sessions) —
  "appointments.view", // see requests waiting for a volunteer (topic, date, city, language; never who) and your own
  "appointments.accept", // accept a request, give it back, mark it done
  "appointments.slots", // publish your own form-filling slots that people book on WhatsApp
  "appointments.documents", // open the person's saved documents, only for a session you hold and only if they agreed
  "appointments.manage", // see every appointment and who holds it, cancel any, remove anyone's slot
] as const;
export type PermissionValue = (typeof PERMISSIONS)[number];

export const VOLUNTEER_ROLES = ["responder", "volunteer", "admin"] as const;

const VOLUNTEER_BUNDLE: PermissionValue[] = [
  "letters.review",
  "letters.view_photo",
  "beneficiaries.view",
  "beneficiaries.edit",
  "documents.view_metadata",
  "documents.view_file",
  "documents.edit",
  "sandbox.use",
  "knowledge.view",
  "conversations.view",
  "conversations.reply",
  "places.view",
  "places.manage",
  "broadcasts.view",
  "broadcasts.create",
  "notes.view",
  "notes.write",
  "tasks.assign",
  "skills.view",
  "skills.edit_own",
  // Approved volunteers may be someone's French buddy; responders (new, unknown to the association) may not.
  "buddies.be_buddy",
  "appointments.view",
  "appointments.accept",
  "appointments.slots",
  "appointments.documents",
];

/**
 * responder: answers beneficiaries in Conversations only (no letters, documents or files), can see today's places
 * but not post them (a posted place reaches beneficiaries without review). Fills in their own skills (so hard
 * cases can be routed to them) but sees no case notes. Default for self-signups.
 * volunteer: full volunteer bundle: letters, documents, conversations, case notes and tasks, skills, posting places,
 * drafting announcements, accepting appointments and publishing form-filling slots. Responders get no appointments:
 * meeting people in person needs an admin's trust, so it is granted per person.
 * Volunteers can also be someone's French practice buddy.
 * admin: + volunteers, audit, knowledge sync, usage, moderating notes, approving announcements, arranging French
 * buddies and handling their reports, managing appointments.
 */
export const ROLE_PERMISSIONS: Record<(typeof VOLUNTEER_ROLES)[number], readonly PermissionValue[]> = {
  responder: ["conversations.view", "conversations.reply", "knowledge.view", "places.view", "skills.edit_own"],
  volunteer: VOLUNTEER_BUNDLE,
  admin: [...VOLUNTEER_BUNDLE, "volunteers.manage", "audit.view", "knowledge.manage", "usage.manage", "notes.moderate", "broadcasts.approve", "buddies.manage", "buddies.reports", "appointments.manage"],
};

/** Kinds of places volunteers post for the day (shown with an emoji in WhatsApp, grouped in this order). */
export const PLACE_KINDS = ["shelter", "food", "shower", "clothes", "health", "other"] as const;
/** What a volunteer can do with a beneficiary (Rendez-vous): come along to an appointment, or fill in a form together. */
export const HELP_KINDS = ["accompaniment", "form_session"] as const;

/**
 * Where the appointment is (accompaniment) or which form (form_session). Order = order in the WhatsApp menus
 * (`help_place_menu` 1–5, `help_form_menu` 1–4).
 */
export const ACCOMPANIMENT_TOPICS = ["prefecture", "ofii", "hospital", "ofpra", "other_place"] as const;
export const FORM_TOPICS = ["caf", "anef", "ame", "other_form"] as const;
export const HELP_TOPICS = [...ACCOMPANIMENT_TOPICS, ...FORM_TOPICS] as const;

/** draft = being typed on WhatsApp (never shown to volunteers). */
export const HELP_STATUSES = ["draft", "open", "accepted", "done", "cancelled", "expired"] as const;
