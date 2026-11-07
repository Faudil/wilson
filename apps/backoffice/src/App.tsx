import type { LanguageCode, Permission } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "./components/Icon";
import { ErrorBox, Sheet, Skeleton } from "./components/ui";
import { useI18n, type MessageKey } from "./i18n";
import { UI_LANGUAGES } from "./i18n/core";
import { orpc } from "./lib/api";
import { fetchMe, ME_KEY } from "./lib/me";
import { useAttentionCount, useDueTasks, useLetterStats, usePendingVolunteers } from "./lib/counts";
import { LazyBoundary, lazyScreens, prefetchScreens } from "./lib/lazy";
import { initials } from "./lib/relative";
import { href, useRoute } from "./lib/router";
import { SessionContext, type Session } from "./lib/session";
import { Home } from "./screens/Home";
import { Login } from "./screens/Login";
import markUrl from "./brand/mark.svg";

// Every other screen is its own chunk, downloaded the first time it is opened: on a slow phone the first page
// only waits for the shell, the login and the home screen.
const { BeneficiaryDetail, BeneficiaryList } = lazyScreens(() => import("./screens/Beneficiaries"), "BeneficiaryDetail", "BeneficiaryList");
const { ConversationDetail, ConversationList } = lazyScreens(() => import("./screens/Conversations"), "ConversationDetail", "ConversationList");
const { Deadlines } = lazyScreens(() => import("./screens/Deadlines"), "Deadlines");
const { LanguageTest } = lazyScreens(() => import("./screens/LanguageTest"), "LanguageTest");
const { Knowledge } = lazyScreens(() => import("./screens/Knowledge"), "Knowledge");
const { LetterReview } = lazyScreens(() => import("./screens/LetterReview"), "LetterReview");
const { Queue } = lazyScreens(() => import("./screens/Queue"), "Queue");
const { Sandbox } = lazyScreens(() => import("./screens/Sandbox"), "Sandbox");
const { Signup } = lazyScreens(() => import("./screens/Signup"), "Signup");
const { Volunteers } = lazyScreens(() => import("./screens/Volunteers"), "Volunteers");
const { BuddyDetail, BuddyList } = lazyScreens(() => import("./screens/Buddies"), "BuddyDetail", "BuddyList");
const { Usage } = lazyScreens(() => import("./screens/Usage"), "Usage");
const { Tasks } = lazyScreens(() => import("./screens/Tasks"), "Tasks");
const { Skills } = lazyScreens(() => import("./screens/Skills"), "Skills");
const { Places } = lazyScreens(() => import("./screens/Places"), "Places");
const { Broadcasts } = lazyScreens(() => import("./screens/Broadcasts"), "Broadcasts");

function useLanguageChange() {
  const { lang, setLang } = useI18n();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity });
  const persist = useMutation({
    ...orpc.auth.setUiLanguage.mutationOptions(),
    onSuccess: (v) => qc.setQueryData(ME_KEY, v),
  });
  const current = UI_LANGUAGES.includes(lang as (typeof UI_LANGUAGES)[number]) ? lang : "en";
  const change = (next: LanguageCode) => {
    setLang(next);
    if (me.data) persist.mutate({ language: next });
  };
  return { current, change };
}

/** Compact select used on the login screen, where there is no account sheet yet. */
function LanguagePicker() {
  const { t } = useI18n();
  const { current, change } = useLanguageChange();
  return (
    <label className="lang-picker">
      <Icon name="globe" size={18} />
      <span className="visually-hidden">{t("ui.language")}</span>
      <select value={current} onChange={(e) => change(e.target.value as LanguageCode)}>
        {UI_LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code} dir={LANGUAGES[code].dir}>
            {LANGUAGES[code].nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function AccountSheet({ open, onClose, onLogout, volunteer }: { open: boolean; onClose: () => void; onLogout: () => void; volunteer: Session["volunteer"] }) {
  const { t } = useI18n();
  const { current, change } = useLanguageChange();
  return (
    <Sheet open={open} onClose={onClose} title={t("account.title")}>
      <div className="stack">
        <div className="account-card">
          <span className="avatar avatar-large" aria-hidden="true">
            {initials(volunteer.name)}
          </span>
          <div>
            <div className="muted small">{t("account.signedInAs")}</div>
            <strong>{volunteer.name}</strong>
            <div className="muted small" dir="ltr">
              {volunteer.email}
            </div>
          </div>
        </div>
        <div className="stack-tight">
          <span className="field-label">{t("ui.language")}</span>
          <div className="segmented segmented-lang" role="radiogroup" aria-label={t("ui.language")}>
            {UI_LANGUAGES.map((code) => (
              <button key={code} type="button" role="radio" aria-checked={code === current} className={code === current ? "is-active" : ""} lang={code} dir={LANGUAGES[code].dir} onClick={() => change(code)}>
                {LANGUAGES[code].nativeName}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn-block btn-danger-quiet" onClick={onLogout}>
          <Icon name="logout" size={18} />
          {t("account.logout")}
        </button>
      </div>
    </Sheet>
  );
}

/** permission: null = everyone; an array = any one of them. */
type NavItem = { key: string; label: MessageKey; icon: IconName; desc?: MessageKey; permission: Permission | Permission[] | null; sandboxOnly?: boolean };

const TABS: NavItem[] = [
  { key: "queue", label: "nav.queue", icon: "mail", permission: "letters.review" },
  { key: "conversations", label: "nav.conversations", icon: "chat", permission: "conversations.view" },
  { key: "beneficiaries", label: "nav.beneficiaries", icon: "users", permission: "beneficiaries.view" },
];
const MORE: NavItem[] = [
  { key: "tasks", label: "nav.tasks", icon: "bell", desc: "more.tasks", permission: "notes.view" },
  { key: "skills", label: "nav.skills", icon: "sparkles", desc: "more.skills", permission: ["skills.view", "skills.edit_own"] },
  { key: "places", label: "nav.places", icon: "home", desc: "more.places", permission: "places.view" },
  { key: "broadcasts", label: "nav.broadcasts", icon: "megaphone", desc: "more.broadcasts", permission: "broadcasts.view" },
  { key: "deadlines", label: "nav.deadlines", icon: "calendar", desc: "more.deadlines", permission: "documents.view_metadata" },
  { key: "knowledge", label: "nav.knowledge", icon: "book", desc: "more.knowledge", permission: "knowledge.view" },
  { key: "buddies", label: "nav.buddies", icon: "hand", desc: "more.buddies", permission: ["buddies.be_buddy", "buddies.manage", "buddies.reports"] },
  { key: "volunteers", label: "nav.volunteers", icon: "users", desc: "more.volunteers", permission: "volunteers.manage" },
  { key: "usage", label: "nav.usage", icon: "chart", desc: "more.usage", permission: "usage.manage" },
  { key: "languages", label: "nav.languages", icon: "globe", desc: "more.languages", permission: null },
  { key: "sandbox", label: "nav.sandbox", icon: "flask", desc: "more.sandbox", permission: "sandbox.use", sandboxOnly: true },
];

function Shell({
  children,
  nav,
  session,
  onLogout,
  focus,
}: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  session?: Session;
  onLogout?: () => void;
  focus?: boolean;
}) {
  const { t } = useI18n();
  const [account, setAccount] = useState(false);
  return (
    <div className={`shell${nav ? " has-nav" : ""}${focus ? " is-focus" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#/">
          <img className="brand-mark" src={markUrl} alt="" width={38} height={38} />
          <span className="brand-text">
            <span className="brand-name">{t("app.name")}</span>
            <span className="brand-sub">{t("app.tagline")}</span>
          </span>
        </a>
        {session && onLogout ? (
          <button type="button" className="avatar" aria-label={t("account.open")} onClick={() => setAccount(true)}>
            {initials(session.volunteer.name)}
          </button>
        ) : (
          <LanguagePicker />
        )}
      </header>
      <main className="content">
        <LazyBoundary>{children}</LazyBoundary>
      </main>
      {nav}
      {session && onLogout && (
        <AccountSheet
          open={account}
          onClose={() => setAccount(false)}
          volunteer={session.volunteer}
          onLogout={() => {
            setAccount(false);
            onLogout();
          }}
        />
      )}
    </div>
  );
}

function TabBar({ items, more, current, badges, moreBadge, onMore }: { items: NavItem[]; more: boolean; current: string; badges: Record<string, number>; moreBadge: number; onMore: () => void }) {
  const { t } = useI18n();
  const moreKeys = MORE.map((m) => m.key);
  const tab = (key: string, icon: IconName, label: string, badge?: number, urgent?: boolean) => (
    <a key={key} href={href(key)} aria-current={current === key ? "page" : undefined} className="tab">
      <span className="tab-icon">
        <Icon name={icon} size={24} />
        {badge ? (
          <span className={`nav-badge${urgent ? " nav-badge-urgent" : ""}`} aria-label={String(badge)}>
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className="tab-label">{label}</span>
    </a>
  );
  return (
    <nav className="tabbar" aria-label={t("nav.label")}>
      <a href="#/" className="tab" aria-current={current === "" ? "page" : undefined}>
        <span className="tab-icon">
          <Icon name="home" size={24} />
        </span>
        <span className="tab-label">{t("nav.home")}</span>
      </a>
      {items.map((n) => tab(n.key, n.icon, t(n.label), badges[n.key], n.key === "conversations"))}
      {more && (
        <button type="button" className="tab" onClick={onMore} aria-haspopup="dialog" aria-current={moreKeys.includes(current) ? "page" : undefined}>
          <span className="tab-icon">
            <Icon name="grid" size={24} />
            {moreBadge ? (
              <span className="nav-badge" aria-label={String(moreBadge)}>
                {moreBadge > 99 ? "99+" : moreBadge}
              </span>
            ) : null}
          </span>
          <span className="tab-label">{t("nav.more")}</span>
        </button>
      )}
    </nav>
  );
}

function MoreSheet({ open, onClose, items, badges }: { open: boolean; onClose: () => void; items: NavItem[]; badges: Record<string, number> }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={t("more.title")}>
      <ul className="more-list">
        {items.map((n) => (
          <li key={n.key}>
            <a href={href(n.key)} className="more-item" onClick={onClose}>
              <span className="more-icon">
                <Icon name={n.icon} size={22} />
              </span>
              <span className="more-text">
                <strong>{t(n.label)}</strong>
                {n.desc && <span className="muted small">{t(n.desc)}</span>}
              </span>
              {badges[n.key] ? <span className="segmented-count">{badges[n.key]}</span> : null}
              <Icon name="chevron" size={18} className="more-chevron" />
            </a>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

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
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [section]);
  const attention = useAttentionCount(!!session && session.can("conversations.view"));
  const letterStats = useLetterStats(!!session && session.can("letters.review"));

  const pendingVolunteers = usePendingVolunteers(!!session && session.can("volunteers.manage"));
  const dueTasks = useDueTasks(!!session && session.can("notes.view"));
  const loggedIn = session !== null;
  useEffect(() => {
    if (loggedIn) prefetchScreens();
  }, [loggedIn]);

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
        <Skeleton lines={2} />
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
    return <Shell>{section === "signup" ? <Signup /> : <Login />}</Shell>;
  }

  const sandboxOn = health.data?.mode === "sandbox";
  const permitted = (p: NavItem["permission"]) => p === null || (Array.isArray(p) ? p.some((x) => session.can(x)) : session.can(p));
  const allowedItem = (n: NavItem) => permitted(n.permission) && (!n.sandboxOnly || sandboxOn);
  const tabs = TABS.filter(allowedItem);
  const moreItems = MORE.filter(allowedItem);
  const allowed = (key: string) => [...tabs, ...moreItems].some((n) => n.key === key);

  let screen: React.ReactNode;
  if (section === "conversations" && arg && allowed("conversations")) screen = <ConversationDetail id={arg} />;
  else if (section === "conversations" && allowed("conversations")) screen = <ConversationList />;
  else if (section === "queue" && allowed("queue")) screen = <Queue />;
  else if (section === "letters" && arg && session.can("letters.review")) screen = <LetterReview id={arg} />;
  else if (section === "beneficiaries" && arg && allowed("beneficiaries")) screen = <BeneficiaryDetail id={arg} />;
  else if (section === "beneficiaries" && allowed("beneficiaries")) screen = <BeneficiaryList />;
  else if (section === "deadlines" && allowed("deadlines")) screen = <Deadlines />;
  else if (section === "knowledge" && allowed("knowledge")) screen = <Knowledge />;
  else if (section === "languages") screen = <LanguageTest />;
  else if (section === "sandbox" && allowed("sandbox")) screen = <Sandbox />;
  else if (section === "volunteers" && allowed("volunteers")) screen = <Volunteers />;
  else if (section === "usage" && allowed("usage")) screen = <Usage />;
  else if (section === "tasks" && allowed("tasks")) screen = <Tasks />;
  else if (section === "skills" && allowed("skills")) screen = <Skills />;
  else if (section === "places" && allowed("places")) screen = <Places />;
  else if (section === "broadcasts" && allowed("broadcasts")) screen = <Broadcasts />;
  else if (section === "buddies" && arg && allowed("buddies")) screen = <BuddyDetail id={arg} />;
  else if (section === "buddies" && allowed("buddies")) screen = <BuddyList />;
  else screen = <Home />;

  const known = ["queue", "conversations", "beneficiaries", "deadlines", "knowledge", "languages", "sandbox", "letters", "volunteers", "usage", "tasks", "skills", "places", "broadcasts", "buddies"];
  const current = section === "letters" ? "queue" : known.includes(section) ? section : "";
  const focus = (section === "letters" || section === "conversations") && !!arg;

  return (
    <SessionContext.Provider value={session}>
      <Shell
        session={session}
        focus={focus}
        onLogout={() => logout.mutate(undefined)}
        nav={
          <>
            <TabBar
              items={tabs}
              more={moreItems.length > 0}
              current={current}
              badges={{ queue: letterStats.pending, conversations: attention }}
              moreBadge={pendingVolunteers + dueTasks}
              onMore={() => setMoreOpen(true)}
            />
            <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} badges={{ volunteers: pendingVolunteers, tasks: dueTasks }} />
          </>
        }
      >
        {screen}
      </Shell>
    </SessionContext.Provider>
  );
}
