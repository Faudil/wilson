import type React from "react";
import { useI18n, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Empty, Skeleton } from "../components/ui";
import type { Permission } from "@wilson/contracts";
import { useAppointmentCounts, useAttentionCount, useDueTasks, useLetterStats, usePendingVolunteers, useTeamWeek, useTopConversation, useWeekDeadlines } from "../lib/counts";
import { Avatar, Who } from "../components/Avatar";
import { Countdown } from "../components/badges";
import { relativeTime } from "../lib/relative";
import { WelcomeTour } from "../components/WelcomeTour";
import { BudgetNotice, useUsageBudget } from "../components/BudgetNotice";
import { firstName, initials, longDate } from "../lib/relative";
import { href } from "../lib/router";
import { canManageMembers, useSession } from "../lib/session";

function Tile({
  to,
  icon,
  count,
  title,
  desc,
  note,
  tone,
  loading,
}: {
  to: string;
  icon: IconName;
  count: number;
  title: string;
  desc: string;
  note?: string;
  tone: "brand" | "accent" | "info";
  loading: boolean;
}) {
  return (
    <a className={`tile tile-${tone}${count > 0 ? " has-items" : ""}`} href={to}>
      <span className="tile-icon">
        <Icon name={icon} size={24} />
      </span>
      <span className="tile-main">
        <span className="tile-title">{title}</span>
        <span className="tile-desc">{desc}</span>
        {note && (
          <span className="tile-note">
            <Icon name="alert" size={14} />
            {note}
          </span>
        )}
      </span>
      <span className="tile-count" aria-label={String(count)}>
        {loading ? "…" : count}
      </span>
      <Icon name="chevron" size={20} className="tile-chevron" />
    </a>
  );
}

/** Tools from the "More" menu worth a shortcut on the home page, for those who may use them. */
const SHORTCUTS: { key: string; icon: IconName; label: MessageKey; desc: MessageKey; permission: Permission }[] = [
  { key: "places", icon: "home", label: "nav.places", desc: "more.places", permission: "places.view" },
  { key: "appointments", icon: "hand", label: "nav.appointments", desc: "more.appointments", permission: "appointments.view" },
  { key: "tasks", icon: "bell", label: "nav.tasks", desc: "more.tasks", permission: "notes.view" },
  { key: "broadcasts", icon: "megaphone", label: "nav.broadcasts", desc: "more.broadcasts", permission: "broadcasts.view" },
];

/** One clear first step, so nobody has to choose between tiles: the person waiting live, else the most urgent letter. */
function NextStep({ letters, chats, dueTasks }: { letters: ReturnType<typeof useLetterStats> | null; chats: boolean; dueTasks: number }) {
  const { t, lang } = useI18n();
  const top = useTopConversation(chats);
  const letter = letters?.next ?? null;
  const someone = (label: string) => (label.startsWith("•") ? t("home.next.someone") : label);
  let body: { to: string; title: string; sub: React.ReactNode; cta: string; who?: React.ReactNode } | null = null;
  if (top && top.status === "needs_human") {
    body = {
      to: href("conversations", top.beneficiaryId),
      title: t("home.next.chat", { name: `\u2068${someone(top.beneficiaryLabel)}\u2069` }),
      sub: top.lastPreview ? <span className="next-quote" dir="auto">« {top.lastPreview} »</span> : null,
      cta: t("home.next.chatCta"),
      who: <Avatar avatar={top.beneficiaryAvatar} seed={top.beneficiaryId} size={44} />,
    };
  } else if (letter) {
    body = {
      to: href("letters", letter.id),
      title: letter.letterType ? t("home.next.letter", { type: t(`letterType.${letter.letterType}` as MessageKey) }) : t("home.next.letterUnknown"),
      sub: (
        <span className="next-meta">
          <Who label={letter.beneficiaryLabel} avatar={letter.beneficiaryAvatar} seed={letter.beneficiaryId} size={28} sub={relativeTime(letter.receivedAt, lang)} />
          {letter.deadline && <Countdown date={letter.deadline} />}
        </span>
      ),
      cta: t("home.next.letterCta"),
    };
  } else if (top) {
    body = {
      to: href("conversations", top.beneficiaryId),
      title: t("home.next.review", { name: `\u2068${someone(top.beneficiaryLabel)}\u2069` }),
      sub: top.lastPreview ? <span className="next-quote" dir="auto">« {top.lastPreview} »</span> : null,
      cta: t("home.next.reviewCta"),
      who: <Avatar avatar={top.beneficiaryAvatar} seed={top.beneficiaryId} size={44} />,
    };
  } else if (dueTasks > 0) {
    body = { to: href("tasks"), title: t("home.next.tasks", { n: dueTasks }), sub: null, cta: t("home.next.tasksCta") };
  }
  if (!body) return null;
  return (
    <a className="next-step" href={body.to}>
      <span className="next-kicker">{t("home.next.kicker")}</span>
      <span className="next-head">
        {body.who}
        <strong className="next-title">{body.title}</strong>
      </span>
      {body.sub}
      <span className="btn btn-primary next-cta">
        {body.cta}
        <Icon name="arrowRight" size={18} />
      </span>
    </a>
  );
}

export function Home() {
  const { t, lang } = useI18n();
  const session = useSession();
  const { volunteer, can } = session;
  const canLetters = can("letters.review");
  const canChats = can("conversations.view");
  const canDeadlines = can("documents.view_metadata");
  const letters = useLetterStats(canLetters);
  const chats = useAttentionCount(canChats);
  const deadlines = useWeekDeadlines(canDeadlines);
  const canVolunteers = canManageMembers(session);
  const signups = usePendingVolunteers(canVolunteers);
  const budget = useUsageBudget(can("usage.manage"));
  const canTasks = can("notes.view");
  const dueTasks = useDueTasks(canTasks);
  const canAppointments = can("appointments.view");
  const appointments = useAppointmentCounts(canAppointments);

  const week = useTeamWeek().data;
  const shortcuts = SHORTCUTS.filter((x) => can(x.permission));
  const list = (names: string[]) => new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(names);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date())) % 24;
  const greetKey: MessageKey = hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening";
  const loading = (canLetters && letters.query.isPending) || (canDeadlines && deadlines.query.isPending);
  const nothing = !loading && (!canLetters || letters.pending === 0) && (!canChats || chats === 0) && (!canDeadlines || deadlines.count === 0) && dueTasks === 0 && (!canAppointments || appointments.open + appointments.mineSoon === 0);

  return (
    <section className="stack-lg">
      <header className="hello">
        <h1>{t(greetKey, { name: `\u2068${firstName(volunteer.name)}\u2069` })}</h1>
        <p className="muted hello-date">{t("home.today", { date: longDate(lang) })}</p>
        {week && week.peopleHelped > 0 ? (
          <>
            <p className="hello-thanks">{t("home.thanks")}</p>
            <ul className="hello-stats">
              <li>
                <strong>{week.peopleHelped}</strong>
                <span>{t(week.peopleHelped === 1 ? "home.stat.person" : "home.stat.people")}</span>
              </li>
              {week.lettersExplained > 0 && (
                <li>
                  <strong>{week.lettersExplained}</strong>
                  <span>{t(week.lettersExplained === 1 ? "home.stat.letter" : "home.stat.letters")}</span>
                </li>
              )}
              {week.repliesSent > 0 && (
                <li>
                  <strong>{week.repliesSent}</strong>
                  <span>{t(week.repliesSent === 1 ? "home.stat.reply" : "home.stat.replies")}</span>
                </li>
              )}
            </ul>
            {week.mine > 0 && <p className="hello-mine">{t("home.mine", { n: week.mine })}</p>}
          </>
        ) : (
          <p className="hello-thanks">{t("home.welcomeLine")}</p>
        )}
      </header>

      <BudgetNotice budget={budget} link={href("usage")} />

      {loading && <Skeleton lines={3} />}

      {!loading && <NextStep letters={canLetters ? letters : null} chats={canChats} dueTasks={canTasks ? dueTasks : 0} />}

      {!loading && (
        <>
          <div className="tiles">
            {canTasks && dueTasks > 0 && (
              <Tile to={href("tasks")} icon="bell" tone="brand" count={dueTasks} loading={false} title={t("home.tasks.title")} desc={t("home.tasks.desc")} />
            )}
            {canLetters && (
              <Tile
                to={href("queue")}
                icon="mail"
                tone="brand"
                count={letters.pending}
                loading={false}
                title={t("home.letters.title")}
                desc={t("home.letters.desc")}
                note={letters.urgent > 0 ? t("home.letters.urgent", { n: letters.urgent }) : undefined}
              />
            )}
            {canChats && <Tile to={href("conversations")} icon="chat" tone="accent" count={chats} loading={false} title={t("home.chats.title")} desc={t("home.chats.desc")} />}
            {canVolunteers && signups > 0 && (
              <Tile to={href("volunteers")} icon="users" tone="info" count={signups} loading={false} title={t("home.volunteers.title")} desc={t("home.volunteers.desc")} />
            )}
            {canAppointments && appointments.open + appointments.mineSoon > 0 && (
              <Tile
                to={href("appointments")}
                icon="hand"
                tone="accent"
                count={appointments.open}
                loading={false}
                title={t("home.appointments.title")}
                desc={t("home.appointments.desc")}
                note={appointments.mineSoon > 0 ? t("home.appointments.mine", { n: appointments.mineSoon }) : undefined}
              />
            )}
            {canDeadlines && <Tile to={href("deadlines")} icon="calendar" tone="info" count={deadlines.count} loading={false} title={t("home.deadlines.title")} desc={t("home.deadlines.desc")} />}
          </div>
          {nothing && (
            <div className="card all-good">
              <Empty art="done" sub={t("home.allGoodText")}>
                {t("home.allGood")}
              </Empty>
            </div>
          )}
          {week && week.helpers.length > 0 && (
            <div className="team-line">
              <span className="team-faces" aria-hidden="true">
                {week.helpers.slice(0, 4).map((n) => (
                  <span key={n} className="team-face">
                    {initials(n)}
                  </span>
                ))}
              </span>
              <span>{t("home.team", { names: `\u2068${list(week.helpers)}\u2069` })}</span>
            </div>
          )}
          {shortcuts.length > 0 && (
            <>
              <h2 className="section-title">{t("home.shortcuts")}</h2>
              <div className="shortcuts">
                {shortcuts.map((x) => (
                  <a key={x.key} className="shortcut" href={href(x.key)}>
                    <span className="tile-icon">
                      <Icon name={x.icon} size={22} />
                    </span>
                    <span className="shortcut-text">
                      <strong>{t(x.label)}</strong>
                      <span className="muted small">{t(x.desc)}</span>
                    </span>
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <WelcomeTour />
    </section>
  );
}
