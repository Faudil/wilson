import { LANGUAGES, type LanguageCode, type Permission } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Loading, ErrorBox } from "./components/ui";
import { useI18n, type MessageKey } from "./i18n";
import { UI_LANGUAGES } from "./i18n/core";
import { orpc } from "./lib/api";
import { fetchMe, ME_KEY } from "./lib/me";
import { href, useRoute } from "./lib/router";
import { SessionContext, type Session } from "./lib/session";
import { BeneficiaryDetail, BeneficiaryList } from "./screens/Beneficiaries";
import { Deadlines } from "./screens/Deadlines";
import { LanguageTest } from "./screens/LanguageTest";
import { LetterReview } from "./screens/LetterReview";
import { Login } from "./screens/Login";
import { Queue } from "./screens/Queue";
import { Sandbox } from "./screens/Sandbox";

function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity });
  const persist = useMutation({
    ...orpc.auth.setUiLanguage.mutationOptions(),
    onSuccess: (v) => qc.setQueryData(ME_KEY, v),
  });
  return (
    <label className="lang-picker">
      <span className="visually-hidden">{t("ui.language")}</span>
      <select
        value={UI_LANGUAGES.includes(lang as (typeof UI_LANGUAGES)[number]) ? lang : "en"}
        onChange={(e) => {
          const next = e.target.value as LanguageCode;
          setLang(next);
          if (me.data) persist.mutate({ language: next });
        }}
      >
        {UI_LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code} dir={LANGUAGES[code].dir}>
            {LANGUAGES[code].nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function Shell({ children, nav, onLogout }: { children: React.ReactNode; nav?: React.ReactNode; onLogout?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          {t("app.name")}
        </a>
        <div className="row">
          <LanguagePicker />
          {onLogout && (
            <button type="button" className="btn btn-small" onClick={onLogout}>
              {t("nav.logout")}
            </button>
          )}
        </div>
      </header>
      <main className="content">{children}</main>
      {nav}
    </div>
  );
}

const NAV: { key: string; label: MessageKey; permission: Permission | null; sandboxOnly?: boolean }[] = [
  { key: "queue", label: "nav.queue", permission: "letters.review" },
  { key: "beneficiaries", label: "nav.beneficiaries", permission: "beneficiaries.view" },
  { key: "deadlines", label: "nav.deadlines", permission: "documents.view_metadata" },
  { key: "languages", label: "nav.languages", permission: null },
  { key: "sandbox", label: "nav.sandbox", permission: "sandbox.use", sandboxOnly: true },
];

export function App() {
  const route = useRoute();
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity, retry: false });
  const health = useQuery({ ...orpc.system.health.queryOptions(), retry: false, staleTime: 60_000 });
  const logout = useMutation({
    ...orpc.auth.logout.mutationOptions(),
    onSettled: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
    },
  });

  // Adopt the volunteer's saved UI language once after login.
  const volunteerLang = me.data?.uiLanguage;
  useEffect(() => {
    if (volunteerLang && volunteerLang !== lang) setLang(volunteerLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volunteerLang]);

  const session = useMemo<Session | null>(
    () => (me.data ? { volunteer: me.data, can: (p) => me.data!.permissions.includes(p) } : null),
    [me.data],
  );

  const [section = "", arg] = route;

  // The language test page needs no backend nor login (no personal data on it).
  if (section === "languages" && !session) {
    return (
      <Shell>
        <LanguageTest />
        <p>
          <a href={href("queue")}>{t("login.title")}</a>
        </p>
      </Shell>
    );
  }

  if (me.isPending) {
    return (
      <Shell>
        <Loading />
      </Shell>
    );
  }
  if (me.isError) {
    return (
      <Shell>
        <ErrorBox error={me.error} retry={() => void me.refetch()} />
        <p>
          <a href={href("languages")}>{t("nav.languages")}</a>
        </p>
      </Shell>
    );
  }
  if (!session) {
    return (
      <Shell>
        <Login />
      </Shell>
    );
  }

  const sandboxOn = health.data?.mode === "sandbox";
  const items = NAV.filter((n) => (n.permission === null || session.can(n.permission)) && (!n.sandboxOnly || sandboxOn));
  const allowed = (key: string) => items.some((n) => n.key === key);

  let screen: React.ReactNode;
  if (section === "letters" && arg && session.can("letters.review")) screen = <LetterReview id={arg} />;
  else if (section === "beneficiaries" && arg && allowed("beneficiaries")) screen = <BeneficiaryDetail id={arg} />;
  else if (section === "beneficiaries" && allowed("beneficiaries")) screen = <BeneficiaryList />;
  else if (section === "deadlines" && allowed("deadlines")) screen = <Deadlines />;
  else if (section === "languages") screen = <LanguageTest />;
  else if (section === "sandbox" && allowed("sandbox")) screen = <Sandbox />;
  else if (allowed("queue")) screen = <Queue />;
  else screen = <p className="muted">{t("error.forbidden")}</p>;

  const current = section === "letters" ? "queue" : section || "queue";

  return (
    <SessionContext.Provider value={session}>
      <Shell
        onLogout={() => logout.mutate(undefined)}
        nav={
          <nav className="tabbar" aria-label={t("nav.label")}>
            {items.map((n) => (
              <a key={n.key} href={href(n.key)} aria-current={current === n.key ? "page" : undefined}>
                {t(n.label)}
              </a>
            ))}
          </nav>
        }
      >
        {screen}
      </Shell>
    </SessionContext.Provider>
  );
}
