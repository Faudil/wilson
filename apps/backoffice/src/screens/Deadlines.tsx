import { useQuery } from "@tanstack/react-query";
import { DeadlineText } from "../components/badges";
import { Empty, ErrorBox, Loading } from "../components/ui";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { href } from "../lib/router";
import { documentTypeName } from "../lib/wilson-i18n";

export function Deadlines() {
  const { t, lang } = useI18n();
  const query = useQuery(orpc.documents.deadlines.queryOptions({ input: { withinDays: 60 } }));
  return (
    <section>
      <h1>{t("deadlines.title")}</h1>
      <p className="muted">{t("deadlines.intro", { days: 60 })}</p>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && query.data.length === 0 && <Empty>{t("deadlines.empty")}</Empty>}
      <ul className="cards">
        {query.data?.map((row) => (
          <li key={row.documentId}>
            <a className={`card card-link ${row.daysLeft <= 7 ? "urgency-high" : row.daysLeft <= 30 ? "urgency-medium" : "urgency-low"}`} href={href("beneficiaries", row.beneficiaryId)}>
              <strong className="card-title">{documentTypeName(row.type, lang)}</strong>
              <DeadlineText date={row.expiresAt} />
              <span className="muted small" dir="ltr">
                {row.beneficiaryLabel}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
