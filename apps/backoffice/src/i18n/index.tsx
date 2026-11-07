import type { LanguageCode } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, translate, type MessageKey, type Params } from "./core";

export type { MessageKey, Params };
export type TFn = (key: MessageKey, params?: Params) => string;

const STORAGE_KEY = "mc.uiLanguage";

export function readStoredLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LANGUAGES) return stored as LanguageCode;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LANGUAGE;
}

/** Sets <html lang dir> from the UI language. */
export function applyDocumentLanguage(lang: LanguageCode): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGUAGES[lang].dir;
}

type Ctx = { lang: LanguageCode; dir: "ltr" | "rtl"; t: TFn; setLang: (lang: LanguageCode) => void };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LanguageCode>(readStoredLanguage);
  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: LANGUAGES[lang].dir,
      t: (key, params) => translate(lang, key, params),
      setLang: (next) => {
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
        setLangState(next);
      },
    }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
