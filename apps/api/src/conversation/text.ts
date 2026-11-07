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

/** Words meaning "menu": show the main menu again (also from the chat). */
const MENU_WORDS = /^(menu|menú|القائمة|قائمة|مینو|مېنو|меню|ማውጫ|menyu|قائمه)$/i;
export const isMenuWord = (text: string): boolean => MENU_WORDS.test(text.trim());

/** A message that is only "stop" (any case) in a few languages: stop announcements. Same as menu 6 → 2. */
const STOP_WORDS = /^(stop|stopp|arr[êe]t|arr[êe]ter|توقف|ايقاف|إيقاف|بس|стоп|stopi|dur|basta|pare|parar)[\s!.]*$/i;
export const isStopWord = (text: string): boolean => STOP_WORDS.test(text.trim());
