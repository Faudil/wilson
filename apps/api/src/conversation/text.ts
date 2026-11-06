/** Map Arabic-Indic (٠-٩) and Persian/Dari/Pashto (۰-۹) digits to ASCII. */
export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** "١" / " 2. " / "⁦3⁩" -> "1" | "2" | "3"; anything that is not a bare 1–2 digit number -> null. */
export function menuChoice(text: string): string | null {
  const t = normalizeDigits(text).replace(/[\s.)\-:‎‏⁦-⁩]/g, "");
  return /^\d{1,2}$/.test(t) ? String(Number(t)) : null;
}

/** Words meaning "language" in the supported languages: same as choosing 3. */
const LANGUAGE_WORDS = /^(language|langue|lang|لغة|اللغة|زبان|ژبه|زبان|мова|мову|ቋንቋ|luuqad|luqad)$/i;
export const isLanguageWord = (text: string): boolean => LANGUAGE_WORDS.test(text.trim());
