import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import type { LanguageCode, Me } from "@wilson/contracts";
import { LANGUAGE_CODES, LANGUAGES, RECOVERY_WORD_COUNT } from "@wilson/contracts/values";
import mark from "../brand/mark.svg";
import { client, errorCode } from "../lib/api";
import { Home } from "./Home";
import { ME_KEY } from "./keys";
import { useT, type T } from "./i18n";
import { WordCards, WordPicker } from "./words";


type View =
  | { name: "welcome" }
  | { name: "signup"; step: 1 | 2 | 3 }
  | { name: "words"; me: Me; words: string[]; fresh: boolean }
  | { name: "login" }
  | { name: "lost" };

/** Why a call failed, in the person's language. */
function errorText(t: T, e: unknown, kind: "words" | "code" | "signup"): string {
  const code = errorCode(e);
  if (code === "TOO_MANY_REQUESTS") {
    const s = (e as { data?: { retryAfterSeconds?: number } }).data?.retryAfterSeconds ?? 60;
    return t("error_too_many", { minutes: Math.max(1, Math.ceil(s / 60)) });
  }
  if (code === "UNAUTHORIZED" && kind === "words") return t("error_words");
  if (code === "UNAUTHORIZED" && kind === "code") return t("error_code");
  if (code === "FORBIDDEN" && kind === "signup") return t("signup_closed");
  return t("error_generic");
}

export function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: () => client.me.get().catch((e) => (errorCode(e) === "UNAUTHORIZED" ? null : Promise.reject(e))),
  });
  const [view, setView] = useState<View>({ name: "welcome" });
  const open = (m: Me) => qc.setQueryData(ME_KEY, m);

  if (me.isPending) return <div className="moi-boot" aria-busy="true" />;
  // Words just drawn are shown before the space opens, even though the session already exists.
  if (view.name === "words") return <WordsScreen {...view} onDone={() => { open(view.me); setView({ name: "welcome" }); }} />;
  if (me.data) return <Home me={me.data} onSignedOut={() => qc.setQueryData(ME_KEY, null)} />;

  switch (view.name) {
    case "signup":
      return <Signup step={view.step} go={(step) => setView(step ? { name: "signup", step } : { name: "welcome" })} done={(m, words) => setView({ name: "words", me: m, words, fresh: true })} />;
    case "login":
      return <Login back={() => setView({ name: "welcome" })} lost={() => setView({ name: "lost" })} done={open} />;
    case "lost":
      return <Lost back={() => setView({ name: "login" })} done={(m, words) => setView({ name: "words", me: m, words, fresh: false })} />;
    default:
      return <Welcome signup={() => setView({ name: "signup", step: 1 })} login={() => setView({ name: "login" })} />;
  }
}

function Shell({ children, back, step }: { children: ReactNode; back?: () => void; step?: number }) {
  const { t } = useT();
  return (
    <div className="moi-shell">
      <header className="moi-top">
        {back ? (
          <button type="button" className="moi-back" onClick={back}>
            <span aria-hidden="true" className="moi-back-arrow">←</span> {t("back")}
          </button>
        ) : (
          <span className="moi-brand"><img src={mark} alt="" width={28} height={28} /> {t("app_title")}</span>
        )}
        {step ? <span className="moi-step">{t("step_of", { n: step, total: 4 })}</span> : null}
      </header>
      {step ? (
        <div className="moi-progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>
          <span style={{ inlineSize: `${(step / 4) * 100}%` }} />
        </div>
      ) : null}
      <main className="moi-main">{children}</main>
    </div>
  );
}

export function LanguageSelect() {
  const { lang, setLang, t } = useT();
  return (
    <label className="moi-lang">
      <span aria-hidden="true">🌐</span>
      <span className="visually-hidden">{t("language")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as LanguageCode)}>
        {LANGUAGE_CODES.map((c) => (
          <option key={c} value={c} lang={c}>{LANGUAGES[c].nativeName}</option>
        ))}
      </select>
    </label>
  );
}

function Welcome({ signup, login }: { signup: () => void; login: () => void }) {
  const { t } = useT();
  const info = useQuery({ queryKey: ["moi", "info"], queryFn: () => client.me.info() });
  return (
    <Shell>
      <div className="moi-hero">
        <img src={mark} alt="" width={72} height={72} />
        <h1>{t("app_title")}</h1>
        {info.data && <p className="moi-assoc">{info.data.associationName}</p>}
        <p className="moi-lead">{t("intro")}</p>
      </div>
      <LanguageSelect />
      <div className="moi-actions">
        {info.data?.signupOpen !== false && <button type="button" className="btn btn-primary btn-block btn-lg" onClick={signup}>{t("start_signup")}</button>}
        <button type="button" className="btn btn-block btn-lg" onClick={login}>{t("start_login")}</button>
      </div>
    </Shell>
  );
}

function Signup({ step, go, done }: { step: 1 | 2 | 3; go: (s: 1 | 2 | 3 | null) => void; done: (m: Me, words: string[]) => void }) {
  const { t, lang, setLang } = useT();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [website, setWebsite] = useState("");
  const create = useMutation({
    mutationFn: () => client.me.signup({ name: name.trim(), language: lang, accepted: true, sharedDevice: shared, website: website || undefined }),
    onSuccess: (r) => done(r.me, r.words),
  });

  if (step === 1) {
    return (
      <Shell back={() => go(null)} step={1}>
        <h1 className="moi-title">🌐 {t("language")}</h1>
        <div className="moi-langs">
          {LANGUAGE_CODES.map((c) => (
            <button key={c} type="button" lang={c} dir={LANGUAGES[c].dir} className={`moi-lang-btn ${c === lang ? "is-current" : ""}`}
              onClick={() => { setLang(c); go(2); }}>
              {LANGUAGES[c].nativeName}
            </button>
          ))}
        </div>
      </Shell>
    );
  }
  if (step === 2) {
    return (
      <Shell back={() => go(1)} step={2}>
        <h1 className="moi-title">{t("about_title")}</h1>
        <ul className="moi-points">
          <li><span className="moi-point-icon" aria-hidden="true">✉️</span><p>{t("about_does")}</p></li>
          <li><span className="moi-point-icon" aria-hidden="true">🛡️</span><p>{t("about_not")}</p></li>
          <li><span className="moi-point-icon" aria-hidden="true">🔒</span><p>{t("about_keeps")}</p></li>
        </ul>
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => go(3)}>{t("understand")}</button>
      </Shell>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <Shell back={() => go(2)} step={3}>
      <form onSubmit={submit} className="moi-form">
        <h1 className="moi-title">{t("name_title")}</h1>
        <p className="moi-hint">{t("name_hint")}</p>
        <input className="moi-input moi-input-lg" value={name} maxLength={40} autoFocus autoComplete="off" placeholder={t("name_placeholder")}
          aria-label={t("name_placeholder")} onChange={(e) => setName(e.target.value)} />
        {/* Honeypot: invisible to people, filled by bots. */}
        <input className="moi-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        <label className="check moi-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          <span>{t("shared_device")}</span>
        </label>
        {create.error && <p className="notice notice-error" role="alert">{errorText(t, create.error, "signup")}</p>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!name.trim() || create.isPending}>{t("continue")}</button>
      </form>
    </Shell>
  );
}

function WordsScreen({ me, words, fresh, onDone }: { me: Me; words: string[]; fresh: boolean; onDone: () => void }) {
  const { t } = useT();
  const [saved, setSaved] = useState(false);
  return (
    <Shell step={fresh ? 4 : undefined}>
      <h1 className="moi-title">🔑 {t(fresh ? "words_title" : "words_title_new")}</h1>
      <p className="moi-hint">{t("words_hint")}</p>
      <WordCards words={words} />
      <p className="moi-handle">{t("words_handle", { handle: me.handle })}</p>
      <label className="check moi-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t("words_saved")}</span>
      </label>
      <button type="button" className="btn btn-primary btn-block btn-lg" disabled={!saved} onClick={onDone}>{t("open_space")}</button>
    </Shell>
  );
}

function Login({ back, lost, done }: { back: () => void; lost: () => void; done: (m: Me) => void }) {
  const { t, setLang } = useT();
  const [words, setWords] = useState<string[]>([]);
  const [shared, setShared] = useState(false);
  const login = useMutation({
    mutationFn: () => client.me.login({ words, sharedDevice: shared }),
    onSuccess: (m) => {
      setLang(m.language);
      done(m);
    },
  });
  const info = useQuery({ queryKey: ["moi", "info"], queryFn: () => client.me.info() });
  const locked = errorCode(login.error) === "FORBIDDEN";
  return (
    <Shell back={back}>
      <h1 className="moi-title">{t("open_space")}</h1>
      <p className="moi-hint">{t("login_hint")}</p>
      <WordPicker value={words} onChange={(w) => { setWords(w); login.reset(); }} />
      <label className="check moi-check">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <span>{t("shared_device")}</span>
      </label>
      {login.error && (
        <p className="notice notice-error" role="alert">
          {locked ? t("error_locked", { association: info.data?.associationName ?? "" }) : errorText(t, login.error, "words")}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block btn-lg" disabled={words.length !== RECOVERY_WORD_COUNT || login.isPending} onClick={() => login.mutate()}>
        {t("open_space")}
      </button>
      <button type="button" className="link-quiet moi-lost" onClick={lost}>{t("lost_words")}</button>
    </Shell>
  );
}

function Lost({ back, done }: { back: () => void; done: (m: Me, words: string[]) => void }) {
  const { t, setLang } = useT();
  const [code, setCode] = useState("");
  const info = useQuery({ queryKey: ["moi", "info"], queryFn: () => client.me.info() });
  const redeem = useMutation({
    mutationFn: () => client.me.redeem({ code, sharedDevice: false }),
    onSuccess: (r) => {
      setLang(r.me.language);
      done(r.me, r.words);
    },
  });
  const ready = code.replace(/[^a-z0-9]/gi, "").length === 8;
  return (
    <Shell back={back}>
      <h1 className="moi-title">{t("lost_words")}</h1>
      <p className="moi-hint">{t("lost_hint", { association: info.data?.associationName ?? "", contact: info.data?.associationContact ?? "" })}</p>
      <form className="moi-form" onSubmit={(e) => { e.preventDefault(); if (ready) redeem.mutate(); }}>
        <label className="field">
          <span className="field-label">{t("code_label")}</span>
          <input className="moi-input moi-input-lg moi-code" dir="ltr" value={code} maxLength={12} autoCapitalize="characters" autoComplete="one-time-code"
            placeholder="XXXX-XXXX" onChange={(e) => { setCode(e.target.value.toUpperCase()); redeem.reset(); }} />
        </label>
        {redeem.error && <p className="notice notice-error" role="alert">{errorText(t, redeem.error, "code")}</p>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!ready || redeem.isPending}>{t("unlock")}</button>
      </form>
    </Shell>
  );
}
