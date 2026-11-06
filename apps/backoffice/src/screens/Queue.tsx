import type { LetterStatus } from "@wilson/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DeadlineText, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { Empty, ErrorBox, Loading } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { href } from "../lib/router";
import { formatDateTime } from "../lib/wilson-i18n";

type Filter = "pending" | "failed" | "sent";
const FILTERS: Record<Filter, LetterStatus[]> = {
  pending: ["pending_review"],
  failed: ["failed", "rejected"],
  sent: ["approved", "sent"],
};

export function Queue() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Filter>("pending");
  const query = useInfiniteQuery(
    orpc.letters.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ status: FILTERS[filter], cursor, limit: 20 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: 30_000,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section>
      <h1>{t("queue.title")}</h1>
      <div className="segmented" role="tablist" aria-label={t("queue.filter")}>
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={f === filter} className={f === filter ? "is-active" : ""} onClick={() => setFilter(f)}>
            {t(`queue.filter.${f}` as MessageKey)}
          </button>
        ))}
      </div>

      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && <Empty>{t(`queue.empty.${filter}` as MessageKey)}</Empty>}

      <ul className="cards">
        {items.map((letter) => (
          <li key={letter.id}>
            <a className={`card card-link urgency-${letter.urgency ?? "none"}`} href={href("letters", letter.id)}>
              <div className="row wrap">
                <LangBadge language={letter.language} />
                <UrgencyBadge urgency={letter.urgency} />
                {filter !== "pending" && <StatusBadge status={letter.status} />}
                {letter.lowConfidence && <span className="badge badge-warn">{t("queue.lowConfidence")}</span>}
              </div>
              <strong className="card-title">
                {letter.letterType ? t(`letterType.${letter.letterType}` as MessageKey) : t("queue.typeUnknown")}
              </strong>
              <div>
                {letter.deadline ? (
                  <>
                    <span className="muted">{t("queue.deadline")} </span>
                    <DeadlineText date={letter.deadline} />
                  </>
                ) : (
                  <span className="muted">{t("queue.noDeadline")}</span>
                )}
              </div>
              <div className="muted small">
                <span dir="ltr">{letter.beneficiaryLabel}</span> · {formatDateTime(letter.receivedAt, lang)}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <button type="button" className="btn btn-block" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {t("common.more")}
        </button>
      )}
    </section>
  );
}
