import type { LanguageCode } from "@wilson/contracts";
import en from "./en.json";
import fr from "./fr.json";

export type MessageKey = keyof typeof fr;
export type Catalog = Record<MessageKey, string>;
export type Params = Record<string, string | number>;

/**
 * French and English ship in the first download (French is the default, English the fallback for every other language).
 * Every other catalog is its own chunk, fetched once when a volunteer picks that language (see loadCatalog).
 */
const LOADERS = {
  ar: () => import("./ar.json"),
  fa: () => import("./fa.json"),
  ps: () => import("./ps.json"),
  ur: () => import("./ur.json"),
  uk: () => import("./uk.json"),
  ti: () => import("./ti.json"),
  so: () => import("./so.json"),
  am: () => import("./am.json"),
  ru: () => import("./ru.json"),
  es: () => import("./es.json"),
  pt: () => import("./pt.json"),
  tr: () => import("./tr.json"),
  ku: () => import("./ku.json"),
  ckb: () => import("./ckb.json"),
  bn: () => import("./bn.json"),
  ta: () => import("./ta.json"),
  ka: () => import("./ka.json"),
  hy: () => import("./hy.json"),
  sq: () => import("./sq.json"),
  ro: () => import("./ro.json"),
  ht: () => import("./ht.json"),
  wo: () => import("./wo.json"),
  ff: () => import("./ff.json"),
  bm: () => import("./bm.json"),
  ln: () => import("./ln.json"),
  sw: () => import("./sw.json"),
} satisfies Record<Exclude<LanguageCode, "fr" | "en">, () => Promise<{ default: Partial<Catalog> }>>;

export const CATALOGS: Partial<Record<LanguageCode, Partial<Catalog>>> = { fr, en };

/** UI languages the picker offers: every language of the WhatsApp bot. */
export const UI_LANGUAGES = ["fr", "en", ...(Object.keys(LOADERS) as (keyof typeof LOADERS)[])] as const satisfies readonly LanguageCode[];
export const DEFAULT_LANGUAGE: LanguageCode = "fr";

/**
 * Catalogs written by machine translation and not yet read by a native speaker. The account sheet tells volunteers so,
 * and asks them to report odd wording. Remove a language from this list once a fluent volunteer has proofread its JSON file.
 */
export const MACHINE_TRANSLATED: ReadonlySet<LanguageCode> = new Set<LanguageCode>([
  "fa", "ps", "ur", "uk", "ti", "so", "am", "ru", "es", "pt", "tr", "ku", "ckb",
  "bn", "ta", "ka", "hy", "sq", "ro", "ht", "wo", "ff", "bm", "ln", "sw",
]);

/** Fetch a language's catalog (no-op when already loaded). A failed download leaves the English fallback in place. */
export async function loadCatalog(lang: LanguageCode): Promise<void> {
  if (CATALOGS[lang] || !(lang in LOADERS)) return;
  try {
    CATALOGS[lang] = (await LOADERS[lang as keyof typeof LOADERS]()).default;
  } catch {
    /* offline or chunk missing: translate() falls back to English */
  }
}

/** Replace `{name}` placeholders. Unknown placeholders are left visible so they get noticed. No concatenation in callers. */
export function format(message: string, params?: Params): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** Lookup with fallback: requested language (once loaded), then English, then French. */
export function translate(lang: LanguageCode, key: MessageKey, params?: Params): string {
  const raw = CATALOGS[lang]?.[key] ?? en[key] ?? fr[key] ?? key;
  return format(raw, params);
}
