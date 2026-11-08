import type { LetterStatus } from "@wilson/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, Countdown, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { Who } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Skeleton } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { relativeTime } from "../lib/relative";
import { takeCelebration } from "../lib/celebrate";
import { href } from "../lib/router";

type Filter = "pending" | "failed" | "sent";
const FILTERS: Record<Filter, LetterStatus[]> = {
  pending: ["pending_review"],
  failed: ["failed", "rejected"],
  sent: ["approved", "sent"],
};

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "is-active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count ? <span className="segmented-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

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
  const [thanks] = useState(takeCelebration);
  const nextLetter = filter === "pending" ? items[0] : undefined;

  return (
    <section className="stack">
      <h1>{t("queue.title")}</h1>
      {thanks && (
        <div className="celebrate" role="status">
          <span className="celebrate-emoji" aria-hidden="true">
            🙏
          </span>
          <span className="celebrate-text">
            <strong>{thanks.label.startsWith("•") ? t("letter.sentToast") : t("celebrate.sentTo", { name: `\u2068${thanks.label}\u2069` })}</strong>
            <span>{query.isSuccess && items.length === 0 && filter === "pending" ? t("celebrate.allDone") : t("celebrate.thanks")}</span>
          </span>
          {nextLetter && (
            <a className="btn btn-primary btn-small" href={href("letters", nextLetter.id)}>
              {t("celebrate.next")}
              <Icon name="arrowRight" size={16} />
            </a>
          )}
        </div>
      )}
      <Segmented
        label={t("queue.filter")}
        value={filter}
        onChange={setFilter}
        options={(Object.keys(FILTERS) as Filter[]).map((f) => ({ value: f, label: t(`queue.filter.${f}` as MessageKey) }))}
      />

      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <Empty
          art={filter === "failed" ? "done" : "letters"}
          action={
            filter === "pending" ? (
              <button type="button" className="btn" onClick={() => setFilter("sent")}>
                {t("queue.seeSent")}
              </button>
            ) : undefined
          }
        >
          {t(`queue.empty.${filter}` as MessageKey)}
        </Empty>
      )}

      <ul className="cards">
        {items.map((letter) => (
          <li key={letter.id}>
            <a className={`card card-link${letter.urgency === "high" ? " is-urgent" : letter.urgency === "medium" ? " is-attention" : ""}`} href={href("letters", letter.id)}>
              <div className="card-top">
                <Who label={letter.beneficiaryLabel} avatar={letter.beneficiaryAvatar} seed={letter.beneficiaryId} sub={relativeTime(letter.receivedAt, lang)} />
                <LangBadge language={letter.language} />
              </div>
              <strong className="card-title">{letter.letterType ? t(`letterType.${letter.letterType}` as MessageKey) : t("queue.typeUnknown")}</strong>
              <div className="chips">
                {filter !== "pending" ? <StatusBadge status={letter.status} /> : <UrgencyBadge urgency={letter.urgency} />}
                {letter.deadline ? <Countdown date={letter.deadline} /> : <span className="muted small">{t("queue.noDeadline")}</span>}
                {letter.lowConfidence && (
                  <Chip tone="warn" icon="eye">
                    {t("queue.lowConfidence")}
                  </Chip>
                )}
              </div>
              <Icon name="chevron" size={20} className="card-chevron" />
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
