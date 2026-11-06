import { LANGUAGES, type ChatIntent, type ChatMessage } from "@wilson/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LangBadge } from "../components/badges";
import { BackLink, Empty, ErrorBox, Loading } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDateTime } from "../lib/wilson-i18n";

type Status = "bot" | "pending_review" | "needs_human" | "resolved";
type Filter = "attention" | "all";

export function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`badge chat-status-${status}`}>{t(`conv.status.${status}` as MessageKey)}</span>;
}

/** Number of conversations waiting for a volunteer (needs_human or pending_review), for the nav badge. */
export function useAttentionCount(enabled: boolean): number {
  const q = useQuery({
    ...orpc.conversations.list.queryOptions({ input: { filter: "attention", limit: 100 } }),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
  return q.data?.items.length ?? 0;
}

export function ConversationList() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Filter>("attention");
  const query = useInfiniteQuery(
    orpc.conversations.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ filter, cursor, limit: 20 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: 15_000,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section>
      <h1>{t("conv.title")}</h1>
      <div className="segmented" role="tablist" aria-label={t("conv.filter")}>
        {(["attention", "all"] as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={f === filter} className={f === filter ? "is-active" : ""} onClick={() => setFilter(f)}>
            {t(`conv.filter.${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && <Empty>{t(`conv.empty.${filter}` as MessageKey)}</Empty>}
      <ul className="cards">
        {items.map((c) => (
          <li key={c.beneficiaryId}>
            <a className={`card card-link chat-card chat-card-${c.status}`} href={href("conversations", c.beneficiaryId)}>
              <div className="row wrap">
                <LangBadge language={c.language} />
                <StatusChip status={c.status} />
                {c.pendingDrafts > 0 && <span className="badge badge-warn">{t("conv.drafts", { n: c.pendingDrafts })}</span>}
              </div>
              <p className="chat-preview" lang="fr">
                {c.lastPreview ?? "…"}
              </p>
              <div className="muted small">
                <span dir="ltr">{c.beneficiaryLabel}</span>
                {c.lastMessageAt && <> · {formatDateTime(c.lastMessageAt, lang)}</>}
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

function Bubble({ m, language, canAct, busy, onApprove, onReject }: {
  m: ChatMessage;
  language: keyof typeof LANGUAGES;
  canAct: boolean;
  busy: boolean;
  onApprove: (textFr?: string) => void;
  onReject: () => void;
}) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
  const [fr, setFr] = useState(m.textFr ?? "");
  const mine = m.author === "beneficiary";
  const draft = m.state === "draft";
  const dir = LANGUAGES[language].dir;
  return (
    <li className={`bubble bubble-${m.author}${draft ? " bubble-draft" : ""}${m.state === "rejected" ? " bubble-rejected" : ""}`}>
      <div className="bubble-meta small muted">
        <span>{mine ? t("conv.author.beneficiary") : m.author === "volunteer" ? (m.volunteerName ?? t("conv.author.volunteer")) : m.author === "bot" ? t("conv.author.bot") : t("conv.author.system")}</span>
        {m.intent && <span className="badge badge-muted">{t(`conv.intent.${m.intent satisfies ChatIntent}` as MessageKey)}</span>}
        {draft && <span className="badge badge-warn">{t("conv.draft")}</span>}
        {m.state === "rejected" && <span className="badge badge-status-rejected">{t("conv.rejected")}</span>}
        <span>{formatDateTime(m.at, lang)}</span>
      </div>
      <p className="bubble-text" lang={language} dir={dir}>
        {m.text}
      </p>
      {m.textFr && language !== "fr" && (
        <p className="bubble-fr" lang="fr" dir="ltr">
          <span className="bubble-fr-tag">FR</span> {m.textFr}
        </p>
      )}
      {m.sources.length > 0 && (
        <p className="small bubble-sources">
          <span className="muted">{t("conv.sources")}: </span>
          {m.sources.map((s, i) => (
            <span key={s.chunkId}>
              {i > 0 && " · "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
            </span>
          ))}
        </p>
      )}
      {draft && canAct && (
        <div className="stack-tight bubble-actions">
          {editing && (
            <label className="field">
              <span>{t("conv.editLabel")}</span>
              <textarea rows={5} maxLength={3000} lang="fr" dir="ltr" value={fr} onChange={(e) => setFr(e.target.value)} />
            </label>
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" disabled={busy || (editing && !fr.trim())} onClick={() => onApprove(editing ? fr.trim() : undefined)}>
              {editing ? t("conv.sendEdited") : t("conv.approve")}
            </button>
            {!editing && (
              <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>
                {t("conv.edit")}
              </button>
            )}
            <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={onReject}>
              {t("conv.reject")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function ConversationDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const session = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const query = useQuery({ ...orpc.conversations.get.queryOptions({ input: { beneficiaryId: id } }), refetchInterval: 10_000 });
  const done = () => {
    void qc.invalidateQueries({ queryKey: orpc.conversations.key() });
  };
  const approve = useMutation({ ...orpc.conversations.approveDraft.mutationOptions(), onSuccess: done });
  const reject = useMutation({ ...orpc.conversations.rejectDraft.mutationOptions(), onSuccess: done });
  const reply = useMutation({
    ...orpc.conversations.reply.mutationOptions(),
    onSuccess: () => {
      setText("");
      done();
    },
  });
  const resolve = useMutation({ ...orpc.conversations.resolve.mutationOptions(), onSuccess: done });
  const canAct = session.can("conversations.reply");
  const busy = approve.isPending || reject.isPending || reply.isPending || resolve.isPending;
  const error = approve.error ?? reject.error ?? reply.error ?? resolve.error;
  const c = query.data;

  return (
    <section>
      <BackLink to={href("conversations")}>{t("nav.conversations")}</BackLink>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {c && (
        <div className="stack">
          <header className="stack-tight">
            <h1>
              <span dir="ltr">{c.beneficiaryLabel}</span>
            </h1>
            <div className="row wrap">
              <LangBadge language={c.language} />
              <StatusChip status={c.status} />
              <a className="small" href={href("beneficiaries", c.beneficiaryId)}>
                {t("nav.beneficiaries")}
              </a>
            </div>
          </header>

          {error && (
            <div className="notice notice-error" role="alert">
              {errorCode(error) === "CONFLICT" ? t("conv.conflict") : t("error.generic")}
            </div>
          )}

          <ul className="thread">
            {c.messages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                language={c.language}
                canAct={canAct}
                busy={busy}
                onApprove={(textFr) => approve.mutate({ messageId: m.id, textFr })}
                onReject={() => reject.mutate({ messageId: m.id })}
              />
            ))}
          </ul>

          {canAct && (
            <form
              className="stack-tight reply-box"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) reply.mutate({ beneficiaryId: id, textFr: text.trim() });
              }}
            >
              <label className="field">
                <span>{t("conv.replyLabel")}</span>
                <textarea rows={3} maxLength={3000} lang="fr" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="row wrap">
                <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
                  {t("conv.send")}
                </button>
                {c.status === "needs_human" && (
                  <button type="button" className="btn" disabled={busy} onClick={() => resolve.mutate({ beneficiaryId: id })}>
                    {t("conv.resolve")}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
