import { LANGUAGES, LANGUAGE_CODES } from "@wilson/contracts";

/** Plain sequential list 1..N in native names, one per line, in LANGUAGE_CODES order; identical in every catalog. */
export const LANGUAGE_MENU: string = LANGUAGE_CODES.map((c, i) => `${i + 1} - ${LANGUAGES[c].nativeName}`).join("\n");

/**
 * Shown above LANGUAGE_MENU, before we know the person's language: the instruction in the three languages most
 * people we help can read (French, English, Arabic), one per line so right-to-left text stays on its own line.
 */
export const LANGUAGE_MENU_HEADER: string = ["🌐 Répondez avec le numéro de votre langue.", "Reply with the number of your language.", "‏أرسل رقم لغتك."].join("\n");
