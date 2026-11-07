import { z } from "zod";
import { LANGUAGE_CODES } from "./values.js";

export { LANGUAGES, LANGUAGE_CODES, isRtl, type LanguageCode } from "./values.js";
export const LanguageSchema = z.enum(LANGUAGE_CODES);
