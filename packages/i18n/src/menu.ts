import { LANGUAGES, LANGUAGE_CODES } from "@wilson/contracts";

/** Numbered list 1..10 in native names; identical in every catalog. */
export const LANGUAGE_MENU: string = LANGUAGE_CODES.map((c, i) => `${i + 1} - ${LANGUAGES[c].nativeName}`).join("\n");
