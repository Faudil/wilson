import type { LanguageCode } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
];

/** "il y a 5 min" in the UI language. Falls back to an empty string on bad input. */
export function relativeTime(iso: string, lang: LanguageCode, now = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const seconds = Math.round((ts - now) / 1000);
  try {
    const rtf = new Intl.RelativeTimeFormat(LANGUAGES[lang].intlLocale, { numeric: "auto", style: "short" });
    for (const [unit, size] of UNITS) {
      if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    }
    return rtf.format(0, "second");
  } catch {
    return "";
  }
}

/** Long written date for the greeting, e.g. "vendredi 6 novembre". */
export function longDate(lang: LanguageCode, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(now);
  } catch {
    return now.toDateString();
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts;
  return chars.map((p) => [...p][0]).join("").slice(0, 2).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
