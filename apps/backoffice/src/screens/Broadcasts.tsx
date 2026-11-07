import type { Broadcast, BroadcastEstimate, LanguageCode } from "@wilson/contracts";
import { LANGUAGES, LANGUAGE_CODES } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { usd } from "./Usage";

const TONE: Record<Broadcast["status"], "ok" | "info" | "muted" | "warn"> = { draft: "warn", sending: "info", sent: "ok", cancelled: "muted" };

/** CONFLICT reason sent by the API (own_broadcast, not_draft, no_recipients). */
function conflictReason(error: unknown): string | null {
  if (errorCode(error) !== "CONFLICT") return null;
  const data = (error as { data?: { reason?: unknown } }).data;
  return typeof data?.reason === "string" ? data.reason : null;
}

function BroadcastError({ error }: { error: unknown }) {
  const { t } = useI18n();
  const reason = conflictReason(error);
  if (reason && ["own_broadcast", "not_draft", "no_recipients"].includes(reason)) {
    return (
      <p className="notice notice-error" role="alert">
        <Icon name="alert" size={20} />
        <span className="notice-body">{t(`bc.conflict.${reason}` as MessageKey)}</span>
      </p>
    );
  }
  return <ErrorBox error={error} />;
}

/** Recipients, free vs paid messages, estimated cost. */
function EstimateBox({ e }: { e: BroadcastEstimate }) {
  const { t, lang } = useI18n();
  return (
    <div className="estimate">
      <p>
        <strong>{t("bc.recipients", { n: e.recipients })}</strong>
      </p>
      {e.byLanguage.length > 0 && (
        <div className="chips">
          {e.byLanguage.map((l) => (
            <span key={l.language} className="row tight">
              <LangBadge language={l.language} />
              <span className="small">{l.count}</span>
            </span>
          ))}
        </div>
      )}
      <ul className="estimate-lines small">
        <li>{t("bc.inWindow", { n: e.inWindow })}</li>
        <li>{t("bc.outsideWindow", { n: e.outsideWindow })}</li>
        <li>
          <strong>{t("bc.cost", { cost: usd(e.whatsappCostCents / 100, lang) })}</strong>
          {e.translations > 0 && <> · {t("bc.translations", { n: e.translations })}</>}
        </li>
      </ul>
    </div>
  );
}

function ComposeSheet({ edit, onClose }: { edit: Broadcast | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(edit?.textFr ?? "");
  const [languages, setLanguages] = useState<LanguageCode[] | null>(edit?.languages ?? null);
  const everyone = useQuery({ ...orpc.broadcasts.estimate.queryOptions({ input: { languages: null } }), staleTime: 30_000 });
  const est = useQuery({ ...orpc.broadcasts.estimate.queryOptions({ input: { languages: languages && languages.length ? languages : null } }), staleTime: 30_000 });
  const done = () => {
    toast(t("bc.savedToast"));
    void qc.invalidateQueries({ queryKey: orpc.broadcasts.key() });
    onClose();
  };
  const create = useMutation({ ...orpc.broadcasts.create.mutationOptions(), onSuccess: done });
  const update = useMutation({ ...orpc.broadcasts.update.mutationOptions(), onSuccess: done });
  const chosen = languages && languages.length ? languages : null;
  const valid = text.trim().length >= 5 && (languages === null || languages.length > 0);
  const counts = new Map((everyone.data?.byLanguage ?? []).map((l) => [l.language, l.count]));
  const shown = LANGUAGE_CODES.filter((c) => counts.has(c) || languages?.includes(c));
  const toggle = (c: LanguageCode) => setLanguages((ls) => (ls?.includes(c) ? ls.filter((x) => x !== c) : [...(ls ?? []), c]));
  return (
    <Sheet open onClose={onClose} title={edit ? t("bc.edit") : t("bc.new")} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const broadcast = { textFr: text.trim(), languages: chosen };
          if (edit) update.mutate({ id: edit.id, broadcast });
          else create.mutate(broadcast);
        }}
      >
        <p className="sheet-text">{t("bc.composeHelp")}</p>
        <label className="field">
          <span className="field-label">{t("bc.text")}</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={900} lang="fr" dir="auto" placeholder={t("bc.textPlaceholder")} required />
          <span className="muted small">{t("bc.textHelp", { n: 900 - text.length })}</span>
        </label>
        <div className="field">
          <span className="field-label">{t("bc.audience")}</span>
          <label className="check">
            <input type="radio" name="audience" checked={languages === null} onChange={() => setLanguages(null)} />
            <span>{t("bc.everyone", { n: everyone.data?.recipients ?? 0 })}</span>
          </label>
          <label className="check">
            <input type="radio" name="audience" checked={languages !== null} onChange={() => setLanguages([])} />
            <span>{t("bc.someLanguages")}</span>
          </label>
          {languages !== null && (
            <div className="weekday-picker">
              {shown.length === 0 && <span className="muted small">{t("bc.nobody")}</span>}
              {shown.map((c) => (
                <button key={c} type="button" aria-pressed={languages.includes(c)} className={`weekday${languages.includes(c) ? " is-active" : ""}`} onClick={() => toggle(c)} lang={c} dir={LANGUAGES[c].dir}>
                  {LANGUAGES[c].nativeName} · {counts.get(c) ?? 0}
                </button>
              ))}
            </div>
          )}
        </div>
        {est.data && <EstimateBox e={est.data} />}
        <p className="muted small">{t("bc.reviewNote")}</p>
        {(create.error ?? update.error) && <BroadcastError error={create.error ?? update.error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || create.isPending || update.isPending}>
            {t("bc.saveDraft")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function ApproveSheet({ b, onClose }: { b: Broadcast; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [language, setLanguage] = useState<LanguageCode>(b.estimate.byLanguage.find((l) => l.language !== "fr")?.language ?? "fr");
  const preview = useQuery({ ...orpc.broadcasts.preview.queryOptions({ input: { id: b.id, language } }), staleTime: Infinity });
  const approve = useMutation({
    ...orpc.broadcasts.approve.mutationOptions(),
    onSuccess: () => {
      toast(t("bc.sentToast"));
      void qc.invalidateQueries({ queryKey: orpc.broadcasts.key() });
      onClose();
    },
  });
  return (
    <Sheet open onClose={onClose} title={t("bc.approveTitle")} wide>
      <div className="stack">
        <EstimateBox e={b.estimate} />
        <label className="field">
          <span className="field-label">{t("bc.previewIn")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode)}>
            {(b.estimate.byLanguage.length ? b.estimate.byLanguage.map((l) => l.language) : (["fr"] as LanguageCode[])).map((c) => (
              <option key={c} value={c} lang={c}>
                {LANGUAGES[c].nativeName}
              </option>
            ))}
          </select>
        </label>
        {preview.isPending && <Skeleton lines={1} />}
        {preview.isError && <ErrorBox error={preview.error} retry={() => void preview.refetch()} />}
        {preview.data && <div className="wa-bubble" lang={language} dir={LANGUAGES[language].dir}>{preview.data.text}</div>}
        <p className="muted small">{t("bc.approveHelp")}</p>
        {approve.error && <BroadcastError error={approve.error} />}
        <div className="stack-tight">
          <button type="button" className="btn btn-block btn-primary" disabled={approve.isPending || b.estimate.recipients === 0} onClick={() => approve.mutate({ id: b.id })}>
            <Icon name="send" size={18} />
            {t("bc.approveSend", { n: b.estimate.recipients })}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Broadcasts() {
  const { t, lang } = useI18n();
  const { can, volunteer } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ ...orpc.broadcasts.list.queryOptions(), refetchInterval: 60_000 });
  const [compose, setCompose] = useState<{ edit: Broadcast | null } | null>(null);
  const [approving, setApproving] = useState<Broadcast | null>(null);
  const cancel = useMutation({
    ...orpc.broadcasts.cancel.mutationOptions(),
    onSuccess: () => {
      toast(t("bc.cancelledToast"));
      void qc.invalidateQueries({ queryKey: orpc.broadcasts.key() });
    },
  });
  const approver = can("broadcasts.approve");

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("bc.title")}</h1>
        {can("broadcasts.create") && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setCompose({ edit: null })}>
            <Icon name="plus" size={16} />
            {t("bc.new")}
          </button>
        )}
      </div>
      <p className="muted">{t("bc.intro")}</p>
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {cancel.error && <BroadcastError error={cancel.error} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="chat">{t("bc.empty")}</Empty>}
      <ul className="cards">
        {q.data?.map((b) => {
          const mine = b.createdById === volunteer.id;
          const editable = b.status === "draft" && (mine || approver);
          return (
            <li key={b.id}>
              <article className={`card bc-card${b.status === "draft" ? " is-attention" : ""}`}>
                <div className="row between">
                  <div className="chips">
                    <Chip tone={TONE[b.status]}>{t(`bc.status.${b.status}` as MessageKey)}</Chip>
                    {b.languages ? b.languages.map((l) => <LangBadge key={l} language={l} />) : <Chip tone="muted">{t("bc.allLanguages")}</Chip>}
                  </div>
                  {editable && (
                    <OverflowMenu label={t("bc.actions")}>
                      {(close) => (
                        <>
                          <button type="button" role="menuitem" onClick={() => { close(); setCompose({ edit: b }); }}>
                            <Icon name="edit" size={18} />
                            {t("bc.edit")}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { close(); cancel.mutate({ id: b.id }); }}>
                            <Icon name="x" size={18} />
                            {t("bc.cancel")}
                          </button>
                        </>
                      )}
                    </OverflowMenu>
                  )}
                </div>
                <p className="bc-text" lang="fr" dir="auto">{b.textFr}</p>
                <p className="muted small">
                  {t("bc.writtenBy", { name: b.createdByName ?? "?", date: formatDate(b.createdAt.slice(0, 10), lang) })}
                  {b.approvedByName && <> · {t("bc.approvedBy", { name: b.approvedByName })}</>}
                </p>
                {b.status === "draft" ? (
                  <>
                    <EstimateBox e={b.estimate} />
                    {approver && (
                      <div className="row wrap">
                        <button type="button" className="btn btn-primary btn-small" onClick={() => setApproving(b)}>
                          <Icon name="send" size={16} />
                          {t("bc.reviewAndSend")}
                        </button>
                        {mine && <span className="muted small">{t("bc.fourEyesHint")}</span>}
                      </div>
                    )}
                    {!approver && <p className="muted small">{t("bc.waitingApproval")}</p>}
                  </>
                ) : b.status !== "cancelled" ? (
                  <p className="small">
                    {t("bc.stats", { sent: b.stats.sent, total: b.stats.total })}
                    {b.stats.awaitingReply > 0 && <> · {t("bc.statsWaiting", { n: b.stats.awaitingReply })}</>}
                    {b.stats.skipped > 0 && <> · {t("bc.statsSkipped", { n: b.stats.skipped })}</>}
                    {b.stats.failed > 0 && <> · {t("bc.statsFailed", { n: b.stats.failed })}</>}
                    {" · "}
                    {t("bc.cost", { cost: usd(b.estimate.whatsappCostCents / 100, lang) })}
                  </p>
                ) : null}
              </article>
            </li>
          );
        })}
      </ul>
      {compose && <ComposeSheet edit={compose.edit} onClose={() => setCompose(null)} />}
      {approving && <ApproveSheet b={approving} onClose={() => setApproving(null)} />}
    </section>
  );
}
