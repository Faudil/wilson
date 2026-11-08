import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LanguageCode } from "@wilson/contracts";
import { LANGUAGE_CODES, LANGUAGES } from "@wilson/contracts/values";
import type { WebKey } from "@wilson/i18n/web/keys";

type Catalog = Record<WebKey, string>;
/** One chunk per language: a phone only downloads the texts of the language it shows. */
const LOADERS: Record<LanguageCode, () => Promise<Catalog>> = {
  fr: () => import("@wilson/i18n/web/fr").then((m) => m.fr),
  en: () => import("@wilson/i18n/web/en").then((m) => m.en),
  ar: () => import("@wilson/i18n/web/ar").then((m) => m.ar),
  fa: () => import("@wilson/i18n/web/fa").then((m) => m.fa),
  ps: () => import("@wilson/i18n/web/ps").then((m) => m.ps),
  ur: () => import("@wilson/i18n/web/ur").then((m) => m.ur),
  uk: () => import("@wilson/i18n/web/uk").then((m) => m.uk),
  ti: () => import("@wilson/i18n/web/ti").then((m) => m.ti),
  so: () => import("@wilson/i18n/web/so").then((m) => m.so),
  am: () => import("@wilson/i18n/web/am").then((m) => m.am),
  ru: () => import("@wilson/i18n/web/ru").then((m) => m.ru),
  es: () => import("@wilson/i18n/web/es").then((m) => m.es),
  pt: () => import("@wilson/i18n/web/pt").then((m) => m.pt),
  tr: () => import("@wilson/i18n/web/tr").then((m) => m.tr),
  ku: () => import("@wilson/i18n/web/ku").then((m) => m.ku),
  ckb: () => import("@wilson/i18n/web/ckb").then((m) => m.ckb),
  bn: () => import("@wilson/i18n/web/bn").then((m) => m.bn),
  ta: () => import("@wilson/i18n/web/ta").then((m) => m.ta),
  ka: () => import("@wilson/i18n/web/ka").then((m) => m.ka),
  hy: () => import("@wilson/i18n/web/hy").then((m) => m.hy),
  sq: () => import("@wilson/i18n/web/sq").then((m) => m.sq),
  ro: () => import("@wilson/i18n/web/ro").then((m) => m.ro),
  ht: () => import("@wilson/i18n/web/ht").then((m) => m.ht),
  wo: () => import("@wilson/i18n/web/wo").then((m) => m.wo),
  ff: () => import("@wilson/i18n/web/ff").then((m) => m.ff),
  bm: () => import("@wilson/i18n/web/bm").then((m) => m.bm),
  ln: () => import("@wilson/i18n/web/ln").then((m) => m.ln),
  sw: () => import("@wilson/i18n/web/sw").then((m) => m.sw),
};

const STORAGE_KEY = "wilson.moi.lang";
const FSI = "\u2068";
const PDI = "\u2069";

/** The stored choice, else the phone's language when Wilson speaks it, else French. */
function initialLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGUAGE_CODES as readonly string[]).includes(stored)) return stored as LanguageCode;
  } catch {
    /* private mode */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.toLowerCase().split("-")[0]!;
    if ((LANGUAGE_CODES as readonly string[]).includes(code)) return code as LanguageCode;
  }
  return "fr";
}

export type T = (key: WebKey, params?: Record<string, string | number>) => string;
type Ctx = { lang: LanguageCode; dir: "ltr" | "rtl"; t: T; setLang: (l: LanguageCode) => void };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(initialLanguage);
  const [catalog, setCatalog] = useState<{ lang: LanguageCode; texts: Catalog } | null>(null);

  useEffect(() => {
    let live = true;
    void LOADERS[lang]().then((texts) => live && setCatalog({ lang, texts }));
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].dir;
    return () => {
      live = false;
    };
  }, [lang]);

  const setLang = useCallback((l: LanguageCode) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo<Ctx | null>(() => {
    if (!catalog) return null;
    // Values (names, numbers, the association) are isolated so they keep their own direction inside RTL text.
    const t: T = (key, params = {}) =>
      catalog.texts[key].replace(/\{(\w+)\}/g, (whole, k: string) =>
        k in params ? (typeof params[k] === "number" ? String(params[k]) : FSI + String(params[k]) + PDI) : whole);
    return { lang: catalog.lang, dir: LANGUAGES[catalog.lang].dir, t, setLang };
  }, [catalog, setLang]);

  if (!value) return <div className="moi-boot" aria-busy="true" />;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useT outside I18nProvider");
  return c;
}
