import { LANGUAGES, LANGUAGE_CODES } from "@wilson/contracts";

/** Plain sequential list 1..N in native names, one per line, in LANGUAGE_CODES order; identical in every catalog. */
export const LANGUAGE_MENU: string = LANGUAGE_CODES.map((c, i) => `${i + 1} - ${LANGUAGES[c].nativeName}`).join("\n");
