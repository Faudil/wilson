import type { Event, EventKind } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useQuery } from "@tanstack/react-query";
import { Chip } from "./badges";
import { Icon } from "./Icon";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";

export const EVENT_EMOJI: Record<EventKind, string> = { maraude: "🚶", meeting: "🗣️", training: "🎓", workshop: "🛠️", info_session: "ℹ️", other: "📌" };

const hours = (e: Event) => (e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime);

/** Home card: my next events and what needs people, in the next 14 days. */
export function EventsCard() {
  const { t, lang } = useI18n();
  const q = useQuery({ ...orpc.events.list.queryOptions({ input: { scope: "upcoming", before: addDays(todayParis(), 15), limit: 20 } }), refetchInterval: 300_000 });
  const items = (q.data ?? []).filter((e) => !e.cancelledAt).slice(0, 3);
  if (!q.isSuccess || items.length === 0) return null;
  return (
    <section className="card events-home stack-tight" aria-labelledby="events-home-title">
      <div className="row between">
        <h2 id="events-home-title" className="section-title"><Icon name="calendar" size={18} /> {t("home.events.title")}</h2>
        <a className="btn btn-small btn-quiet" href="#/events">{t("home.events.all")}</a>
      </div>
      <ul className="events-home-list">
        {items.map((e) => (
          <li key={e.id}>
            <a href={`#/events/${e.id}`} className="events-home-row">
              <span className="events-home-date">
                <span className="events-home-day">{Number(e.date.slice(8))}</span>
                <span className="events-home-month">{new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, { month: "short", timeZone: "UTC" }).format(new Date(`${e.date}T12:00:00Z`))}</span>
              </span>
              <span className="events-home-main">
                <strong lang="fr">{EVENT_EMOJI[e.kind]} {e.title}</strong>
                <span className="muted small" dir="auto">{hours(e)}{e.place ? ` · ${e.place}` : ""}</span>
                <span className="events-home-chip">
                  {e.myStatus === "going" ? <Chip tone="ok" icon="check">{t("ev.youreIn")}</Chip>
                    : e.myStatus === "waitlist" ? <Chip tone="warn" icon="clock">{t("ev.waitingShort")}</Chip>
                    : e.matchesMe ? <Chip tone="info" icon="sparkles">{t("ev.matchesMe")}</Chip>
                    : e.volunteerSpots !== null && e.going < e.volunteerSpots ? <Chip tone="muted">{t("ev.spotsLeft", { n: e.volunteerSpots - e.going })}</Chip> : null}
                </span>
              </span>

            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
