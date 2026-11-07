import { useQuery } from "@tanstack/react-query";
import { Countdown } from "../components/badges";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Skeleton } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { href } from "../lib/router";
import { documentTypeName, formatDate } from "../lib/wilson-i18n";

type Group = "week" | "month" | "later";
const groupOf = (days: number): Group => (days <= 7 ? "week" : days <= 30 ? "month" : "later");

export function Deadlines() {
  const { t, lang } = useI18n();
  const query = useQuery(orpc.documents.deadlines.queryOptions({ input: { withinDays: 60 } }));
  const rows = query.data ?? [];
  const groups: Group[] = ["week", "month", "later"];
  return (
    <section className="stack">
      <div>
        <h1>{t("deadlines.title")}</h1>
        <p className="muted">{t("deadlines.intro", { days: 60 })}</p>
      </div>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && rows.length === 0 && (
        <Empty art="calendar" sub={t("deadlines.emptySub")}>
          {t("deadlines.empty")}
        </Empty>
      )}
      {groups.map((g) => {
        const list = rows.filter((r) => groupOf(r.daysLeft) === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="stack-tight">
            <h2 className="section-title">{t(`deadlines.group.${g}` as MessageKey)}</h2>
            <ul className="cards">
              {list.map((row) => (
                <li key={row.documentId}>
                  <a className={`card card-link${row.daysLeft <= 7 ? " is-urgent" : row.daysLeft <= 30 ? " is-attention" : ""}`} href={href("beneficiaries", row.beneficiaryId)}>
                    <div className="card-top">
                      <strong className="card-title">{documentTypeName(row.type, lang)}</strong>
                      <Countdown date={row.expiresAt} />
                    </div>
                    <span className="card-kicker">
                      <Icon name="calendar" size={16} />
                      {formatDate(row.expiresAt, lang, { weekday: true })}
                    </span>
                    <span className="card-kicker" dir="ltr">
                      <Icon name="user" size={16} />
                      {row.beneficiaryLabel}
                    </span>
                    <Icon name="chevron" size={20} className="card-chevron" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
