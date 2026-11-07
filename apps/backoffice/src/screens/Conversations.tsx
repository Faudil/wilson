import type { ChatIntent, ChatMessage, ConversationSummary } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { Icon, type IconName } from "../components/Icon";
import { BackLink, Empty, ErrorBox, Skeleton, useToast } from "../components/ui";
import { Segmented } from "./Queue";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDateTime } from "../lib/wilson-i18n";
import { relativeTime } from "../lib/relative";

type Status = ConversationSummary["status"];
type Filter = "attention" | "mine" | "all";

const CHAT_VIEW: Record<Status, { tone: "ok" | "warn" | "urgent" | "info" | "muted"; icon: IconName }> = {
  bot: { tone: "info", icon: "bot" },
  pending_review: { tone: "warn", icon: "eye" },
  needs_human: { tone: "urgent", icon: "hand" },
  with_volunteer: { tone: "ok", icon: "user" },
  resolved: { tone: "ok", icon: "checkCircle" },
};

export function StatusChip({ status }: { status: Status }) {
  const { t } = useI18n();
  const v = CHAT_VIEW[status];
  return (
    <Chip tone={v.tone} icon={v.icon}>
      {t(`conv.status.${status}` as MessageKey)}
    </Chip>
  );
}

/** Conversations waiting for a volunteer (needs_human, pending_review, or held by a volunteer with an unanswered message). */
export function ConversationList() {
  const { t, lang } = useI18n();
  const { volunteer: me } = useSession();
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
    <section className="stack">
      <h1>{t("conv.title")}</h1>
      <Segmented
        label={t("conv.filter")}
        value={filter}
        onChange={setFilter}
        options={(["attention", "mine", "all"] as Filter[]).map((f) => ({ value: f, label: t(`conv.filter.${f}` as MessageKey) }))}
      />
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <Empty art="chat" sub={filter === "attention" ? t("conv.empty.attention.sub") : filter === "mine" ? t("conv.empty.mine.sub") : undefined}>
          {t(`conv.empty.${filter}` as MessageKey)}
        </Empty>
      )}
      <ul className="cards">
        {items.map((c) => (
          <li key={c.beneficiaryId}>
            <a className={`card card-link${c.status === "needs_human" ? " is-urgent" : c.status === "pending_review" || (c.status === "with_volunteer" && c.awaitingReply) ? " is-attention" : ""}`} href={href("conversations", c.beneficiaryId)}>
              <div className="card-top">
                <span className="card-kicker">
                  <Icon name="chat" size={16} />
                  <span dir="ltr">{c.beneficiaryLabel}</span>
                  {c.lastMessageAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(c.lastMessageAt, lang)}</span>
                    </>
                  )}
                </span>
                <LangBadge language={c.language} />
              </div>
              <p className="chat-preview" lang="fr">
                {c.lastPreview ?? "…"}
              </p>
              <div className="chips">
                <StatusChip status={c.status} />
                {c.assignee && (
                  <Chip tone="muted" icon="user">
                    {t("conv.assignee", { name: c.assignee.id === me.id ? t("vol.you") : c.assignee.name })}
                  </Chip>
                )}
                {c.awaitingReply && c.status === "with_volunteer" && (
                  <Chip tone="warn" icon="clock">
                    {t("conv.awaiting")}
                  </Chip>
                )}
                {c.pendingDrafts > 0 && (
                  <Chip tone="warn" icon="edit">
                    {t("conv.drafts", { n: c.pendingDrafts })}
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

/** Splits off the fixed legal footer so volunteers see the message itself first. */
function withoutFooter(text: string, footer: string): { body: string; hasFooter: boolean } {
  const i = footer ? text.lastIndexOf(footer) : -1;
  return i > 0 && i + footer.length >= text.trimEnd().length ? { body: text.slice(0, i).trimEnd(), hasFooter: true } : { body: text, hasFooter: false };
}

function Bubble({ m, language, footer, canAct, busy, onApprove, onReject }: {
  m: ChatMessage;
  language: keyof typeof LANGUAGES;
  footer: string;
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
  const { body, hasFooter } = withoutFooter(m.text, footer);
  const frFirst = language !== "fr" && !!m.textFr;
  const who = mine ? t("conv.author.beneficiary") : m.author === "volunteer" ? (m.volunteerName ?? t("conv.author.volunteer")) : m.author === "bot" ? t("conv.author.bot") : t("conv.author.system");
  return (
    <li className={`bubble bubble-${m.author}${draft ? " bubble-draft" : ""}${m.state === "rejected" ? " bubble-rejected" : ""}`}>
      <div className="bubble-meta small">
        <Icon name={mine ? "user" : m.author === "bot" ? "bot" : m.author === "volunteer" ? "hand" : "info"} size={14} />
        <span className="bubble-who">{who}</span>
        {draft && (
          <Chip tone="warn" icon="edit">
            {t("conv.draft")}
          </Chip>
        )}
        {m.state === "rejected" && (
          <Chip tone="muted" icon="x">
            {t("conv.rejected")}
          </Chip>
        )}
        {m.intent && <span className="pill">{t(`conv.intent.${m.intent satisfies ChatIntent}` as MessageKey)}</span>}
      </div>
      {/* French first for volunteers; what the person reads (their language) stays one tap away. */}
      {frFirst ? (
        <>
          <p className="bubble-text long-text" lang="fr" dir="ltr">
            {withoutFooter(m.textFr!, footer).body}
          </p>
          <details className="bubble-original">
            <summary className="small">{t("conv.showOriginal", { language: LANGUAGES[language].nativeName })}</summary>
            <p className="bubble-fr long-text" lang={language} dir={dir}>
              {body}
            </p>
          </details>
        </>
      ) : (
        <p className="bubble-text long-text" lang={language} dir={dir}>
          {body}
        </p>
      )}
      {hasFooter && (
        <details className="bubble-footer">
          <summary className="small muted">
            <Icon name="info" size={12} /> {t("conv.footerFolded")}
          </summary>
          <p className="small muted long-text" lang={language} dir={dir}>
            {footer}
          </p>
        </details>
      )}
      {m.sources.length > 0 && (
        <p className="small bubble-sources">
          <Icon name="link" size={14} />
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
              <span className="field-label">{t("conv.editLabel")}</span>
              <textarea rows={5} maxLength={3000} lang="fr" dir="ltr" value={fr} onChange={(e) => setFr(e.target.value)} />
            </label>
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-primary btn-small" disabled={busy || (editing && !fr.trim())} onClick={() => onApprove(editing ? fr.trim() : undefined)}>
              <Icon name="send" size={16} />
              {editing ? t("conv.sendEdited") : t("conv.approve")}
            </button>
            {!editing && (
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => setEditing(true)}>
                <Icon name="edit" size={16} />
                {t("conv.edit")}
              </button>
            )}
            {editing && (
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
            )}
            <button type="button" className="btn btn-small btn-danger-quiet" disabled={busy} onClick={onReject}>
              <Icon name="x" size={16} />
              {t("conv.reject")}
            </button>
          </div>
        </div>
      )}
      <span className="bubble-time small muted">{formatDateTime(m.at, lang)}</span>
    </li>
  );
}

export function ConversationDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const query = useQuery({ ...orpc.conversations.get.queryOptions({ input: { beneficiaryId: id } }), refetchInterval: 10_000 });
  const c = query.data;
  const done = () => {
    void qc.invalidateQueries({ queryKey: orpc.conversations.key() });
  };
  const approve = useMutation({
    ...orpc.conversations.approveDraft.mutationOptions(),
    onSuccess: () => {
      toast(t("conv.approvedToast"));
      done();
    },
  });
  const reject = useMutation({
    ...orpc.conversations.rejectDraft.mutationOptions(),
    onSuccess: () => {
      toast(t("conv.rejectedToast"), "info");
      done();
    },
  });
  const reply = useMutation({
    ...orpc.conversations.reply.mutationOptions(),
    onSuccess: () => {
      setText("");
      toast(t("conv.sentToast"));
      done();
    },
  });
  const resolve = useMutation({
    ...orpc.conversations.resolve.mutationOptions(),
    onSuccess: (d) => {
      toast(c?.status === "with_volunteer" ? t("conv.handedBackToast") : t("conv.resolvedToast"));
      qc.setQueryData(orpc.conversations.get.queryKey({ input: { beneficiaryId: id } }), d);
      done();
    },
  });
  const takeOver = useMutation({
    ...orpc.conversations.takeOver.mutationOptions(),
    onSuccess: (d) => {
      toast(t("conv.takenToast"));
      qc.setQueryData(orpc.conversations.get.queryKey({ input: { beneficiaryId: id } }), d);
      done();
    },
    onError: () => void query.refetch(),
  });
  const canAct = session.can("conversations.reply");
  const busy = approve.isPending || reject.isPending || reply.isPending || resolve.isPending || takeOver.isPending;
  const error = approve.error ?? reject.error ?? reply.error ?? resolve.error ?? takeOver.error;
  const conflictText = takeOver.error ? t("conv.assignedConflict") : t("conv.conflict");
  const mine = c?.assignee?.id === session.volunteer.id;
  const count = c?.messages.length ?? 0;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const send = () => {
    if (text.trim()) reply.mutate({ beneficiaryId: id, textFr: text.trim() });
  };

  return (
    <section className={canAct ? "has-composer" : ""}>
      <BackLink to={href("conversations")}>{t("conv.title")}</BackLink>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {c && (
        <div className="stack">
          <header className="chat-head">
            <span className="avatar avatar-soft" aria-hidden="true">
              <Icon name="user" size={22} />
            </span>
            <div className="chat-head-main">
              <h1>
                <span dir="ltr">{c.beneficiaryLabel}</span>
              </h1>
              <div className="chips">
                <LangBadge language={c.language} />
                <StatusChip status={c.status} />
              </div>
            </div>
            {session.can("beneficiaries.view") && (
              <a className="icon-btn" href={href("beneficiaries", c.beneficiaryId)} aria-label={t("nav.beneficiaries")}>
                <Icon name="users" />
              </a>
            )}
          </header>

          {c.status === "needs_human" && (
            <div className="callout callout-urgent">
              <Icon name="hand" size={20} />
              <div>
                <strong>{t("conv.needsYou")}</strong>
                {canAct && (
                  <div className="row wrap">
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => takeOver.mutate({ beneficiaryId: id })}>
                      <Icon name="user" size={16} />
                      {t("conv.takeOver")}
                    </button>
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => resolve.mutate({ beneficiaryId: id })}>
                      <Icon name="checkCircle" size={16} />
                      {t("conv.resolveLong")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {c.status === "with_volunteer" && c.assignee && (
            <div className="callout callout-ok">
              <Icon name="user" size={20} />
              <div>
                <strong>{mine ? t("conv.takenByYou") : t("conv.takenBy", { name: c.assignee.name })}</strong>
                {canAct && (
                  <div className="row wrap">
                    {!mine && (
                      <button type="button" className="btn btn-small" disabled={busy} onClick={() => takeOver.mutate({ beneficiaryId: id, force: true })}>
                        <Icon name="user" size={16} />
                        {t("conv.takeOverForce")}
                      </button>
                    )}
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => resolve.mutate({ beneficiaryId: id })}>
                      <Icon name="bot" size={16} />
                      {t("conv.handBack")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {canAct && c.status !== "needs_human" && c.status !== "with_volunteer" && (
            <div className="callout callout-info">
              <Icon name="info" size={20} />
              <div>
                <span>{t("conv.takeOverHint")}</span>
                <div>
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => takeOver.mutate({ beneficiaryId: id })}>
                    <Icon name="user" size={16} />
                    {t("conv.takeOver")}
                  </button>
                </div>
              </div>
            </div>
          )}
          {c.status === "pending_review" && (
            <div className="callout">
              <Icon name="eye" size={20} />
              <strong>{t("conv.reviewNeeded")}</strong>
            </div>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              <Icon name="alert" />
              <span className="notice-body">{errorCode(error) === "CONFLICT" ? conflictText : t("error.generic")}</span>
            </div>
          )}

          {c.messages.length === 0 && <Empty art="chat">{t("conv.emptyThread")}</Empty>}
          <ul className="thread">
            {c.messages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                language={c.language}
                footer={c.footer}
                canAct={canAct}
                busy={busy}
                onApprove={(textFr) => approve.mutate({ messageId: m.id, textFr })}
                onReject={() => reject.mutate({ messageId: m.id })}
              />
            ))}
          </ul>
          <div ref={endRef} />
        </div>
      )}

      {c && canAct && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="composer-inner">
            <div className="composer-field">
              <textarea
                rows={1}
                maxLength={3000}
                lang="fr"
                dir="ltr"
                value={text}
                placeholder={t("conv.composerPlaceholder")}
                aria-label={t("conv.replyLabel")}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <span className="composer-hint">
                <Icon name="globe" size={12} /> {t("conv.composerHint")}
              </span>
              {!c.windowOpen && (
                <span className="composer-hint composer-hint-warn">
                  <Icon name="clock" size={12} /> {t("conv.windowClosed")}
                </span>
              )}
            </div>
            <button type="submit" className="send-btn" disabled={busy || !text.trim()} aria-label={t("conv.send")}>
              <Icon name="send" size={22} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
