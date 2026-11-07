import { useI18n, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Empty, Skeleton } from "../components/ui";
import { useAttentionCount, useDueTasks, useLetterStats, usePendingVolunteers, useWeekDeadlines } from "../lib/counts";
import { BudgetNotice, useUsageBudget } from "../components/BudgetNotice";
import { firstName, longDate } from "../lib/relative";
import { href } from "../lib/router";
import { useSession } from "../lib/session";

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

export function Home() {
  const { t, lang } = useI18n();
  const { volunteer, can } = useSession();
  const canLetters = can("letters.review");
  const canChats = can("conversations.view");
  const canDeadlines = can("documents.view_metadata");
  const letters = useLetterStats(canLetters);
  const chats = useAttentionCount(canChats);
  const deadlines = useWeekDeadlines(canDeadlines);
  const canVolunteers = can("volunteers.manage");
  const signups = usePendingVolunteers(canVolunteers);
  const budget = useUsageBudget(can("usage.manage"));
  const canTasks = can("notes.view");
  const dueTasks = useDueTasks(canTasks);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date())) % 24;
  const greetKey: MessageKey = hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening";
  const loading = (canLetters && letters.query.isPending) || (canDeadlines && deadlines.query.isPending);
  const nothing = !loading && (!canLetters || letters.pending === 0) && (!canChats || chats === 0) && (!canDeadlines || deadlines.count === 0) && dueTasks === 0;

  return (
    <section className="stack-lg">
      <header className="hello">
        <h1>{t(greetKey, { name: `\u2068${firstName(volunteer.name)}\u2069` })}</h1>
        <p className="muted hello-date">{t("home.today", { date: longDate(lang) })}</p>
      </header>

      <BudgetNotice budget={budget} link={href("usage")} />

      {loading && <Skeleton lines={3} />}

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
            {canDeadlines && <Tile to={href("deadlines")} icon="calendar" tone="info" count={deadlines.count} loading={false} title={t("home.deadlines.title")} desc={t("home.deadlines.desc")} />}
          </div>
          {nothing && (
            <div className="card all-good">
              <Empty art="done" sub={t("home.allGoodText")}>
                {t("home.allGood")}
              </Empty>
            </div>
          )}
        </>
      )}
    </section>
  );
}
