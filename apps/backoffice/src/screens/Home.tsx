import { useI18n, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../components/Icon";
import { Empty, Skeleton } from "../components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { useAppointmentCounts, useAttentionCount, useBackupCounts, useDueTasks, useLetterStats, useNewsUnread, usePendingVolunteers, useWeekDeadlines } from "../lib/counts";
import { BudgetNotice, useUsageBudget } from "../components/BudgetNotice";
import { EventsCard } from "../components/EventsCard";
import { firstName, longDate, relativeTime } from "../lib/relative";
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

/** Unread team news, newest first: the first lines of each, "read all" and "mark as read". */
function NewsCard({ count, latest }: { count: number; latest: ReturnType<typeof useNewsUnread>["latest"] }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const markRead = useMutation({ ...orpc.news.markRead.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.news.key() }) });
  if (count === 0 || latest.length === 0) return null;
  return (
    <section className="card home-news" aria-labelledby="home-news-title">
      <div className="row between">
        <h2 id="home-news-title" className="home-news-title">
          <Icon name="megaphone" size={20} />
          {t("home.news.title")}
        </h2>
        <span className="segmented-count" aria-label={String(count)}>{count}</span>
      </div>
      <ul className="home-news-list">
        {latest.slice(0, 2).map((p) => (
          <li key={p.id}>
            <a href={href("news")} className="home-news-item">
              <strong dir="auto">{p.title}</strong>
              <span className="home-news-excerpt" dir="auto">{p.body}</span>
              <span className="muted small">{p.authorName ? t("news.byWhen", { name: p.authorName, when: relativeTime(p.createdAt, lang) }) : relativeTime(p.createdAt, lang)}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="row wrap">
        <a className="btn btn-small btn-primary" href={href("news")}>{count > 2 ? t("home.news.readAll", { n: count }) : t("home.news.read")}</a>
        <button type="button" className="btn btn-small btn-quiet" disabled={markRead.isPending} onClick={() => markRead.mutate({ ids: latest.map((p) => p.id) })}>
          <Icon name="check" size={16} />
          {t("home.news.markRead")}
        </button>
      </div>
    </section>
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
  const news = useNewsUnread(can("news.view"));
  const canBackup = can("backup.view");
  const backup = useBackupCounts(canBackup);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Paris" }).format(new Date())) % 24;
  const greetKey: MessageKey = hour < 12 ? "home.morning" : hour < 18 ? "home.afternoon" : "home.evening";
  const loading = (canLetters && letters.query.isPending) || (canDeadlines && deadlines.query.isPending);
  const nothing = !loading && (!canLetters || letters.pending === 0) && (!canChats || chats === 0) && (!canDeadlines || deadlines.count === 0) && dueTasks === 0 && (!canAppointments || appointments.open + appointments.mineSoon === 0) && (!canBackup || backup.open === 0) && news.count === 0;

  return (
    <section className="stack-lg">
      <header className="hello">
        <h1>{t(greetKey, { name: `\u2068${firstName(volunteer.name)}\u2069` })}</h1>
        <p className="muted hello-date">{t("home.today", { date: longDate(lang) })}</p>
      </header>

      <BudgetNotice budget={budget} link={href("usage")} />

      <NewsCard count={news.count} latest={news.latest} />

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
            {canBackup && backup.open > 0 && (
              <Tile
                to={href("backup")}
                icon="hand"
                tone="accent"
                count={backup.open}
                loading={false}
                title={t("home.backup.title")}
                desc={t("home.backup.desc")}
                note={backup.forMe > 0 ? t("home.backup.forMe", { n: backup.forMe }) : undefined}
              />
            )}
            {canDeadlines && <Tile to={href("deadlines")} icon="calendar" tone="info" count={deadlines.count} loading={false} title={t("home.deadlines.title")} desc={t("home.deadlines.desc")} />}
          </div>
          {can("events.view") && <EventsCard />}
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
