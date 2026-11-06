import { LANGUAGES, type LetterDetail, type LetterText } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DeadlineText, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { BackLink, ErrorBox, Loading, useObjectUrl } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { linesToList } from "../lib/format";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDateTime } from "../lib/wilson-i18n";

type Draft = { title: string; summary: string; actions: string; orientation: string };

const toDraft = (fr: LetterText): Draft => ({
  title: fr.title,
  summary: fr.summary,
  actions: fr.actions.join("\n"),
  orientation: fr.orientation.join("\n"),
});
const fromDraft = (d: Draft): LetterText => ({
  title: d.title.trim(),
  summary: d.summary.trim(),
  actions: linesToList(d.actions),
  orientation: linesToList(d.orientation),
});

export function LetterReview({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useQuery(orpc.letters.get.queryOptions({ input: { id } }));
  return (
    <section>
      <BackLink to={href("queue")}>{t("nav.queue")}</BackLink>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && <Review detail={query.data} />}
    </section>
  );
}

function Photo({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useQuery({ ...orpc.letters.photo.queryOptions({ input: { id } }), retry: false, staleTime: Infinity });
  const url = useObjectUrl(q.data);
  const [zoom, setZoom] = useState(false);
  if (q.isPending) return <Loading />;
  if (q.isError || !url) return <p className="muted">{t("letter.photoGone")}</p>;
  const isPdf = q.data?.type === "application/pdf";
  return isPdf ? (
    <a className="btn" href={url} target="_blank" rel="noreferrer">
      {t("letter.openPdf")}
    </a>
  ) : (
    <button type="button" className={`photo-button ${zoom ? "is-zoom" : ""}`} onClick={() => setZoom(!zoom)} aria-label={t("letter.photoZoom")}>
      <img src={url} alt={t("letter.photoAlt")} />
    </button>
  );
}

function Review({ detail }: { detail: LetterDetail }) {
  const { t, lang: uiLang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const analysis = detail.analysis;
  const editable = detail.status === "pending_review" && can("letters.review");

  const original = useMemo(() => (analysis ? toDraft(analysis.fr) : null), [analysis]);
  const [draft, setDraft] = useState<Draft | null>(original);
  useEffect(() => {
    setDraft(original);
  }, [original]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [showFr, setShowFr] = useState(false);

  const dirty = !!draft && !!original && (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== original[k]);
  const parsed = draft ? fromDraft(draft) : null;
  const invalid =
    !parsed || !parsed.title || !parsed.summary || parsed.orientation.length < 1 || parsed.orientation.length > 4 || parsed.actions.length > 6;

  const refresh = (next: LetterDetail) => {
    qc.setQueryData(orpc.letters.get.queryKey({ input: { id: detail.id } }), next);
    void qc.invalidateQueries({ queryKey: orpc.letters.list.key() });
  };
  const edit = useMutation({ ...orpc.letters.edit.mutationOptions(), onSuccess: refresh });
  const approve = useMutation({ ...orpc.letters.approve.mutationOptions(), onSuccess: refresh });
  const reject = useMutation({ ...orpc.letters.reject.mutationOptions(), onSuccess: (d) => { setRejecting(false); refresh(d); } });
  const busy = edit.isPending || approve.isPending || reject.isPending;
  const error = edit.error ?? approve.error ?? reject.error;

  const save = () => parsed && edit.mutate({ id: detail.id, fr: parsed });
  const doApprove = async () => {
    if (!window.confirm(t("letter.confirmApprove"))) return;
    if (dirty && parsed) await edit.mutateAsync({ id: detail.id, fr: parsed });
    approve.mutate({ id: detail.id });
  };

  const target = LANGUAGES[detail.language];
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  return (
    <div className="stack">
      <header className="stack-tight">
        <div className="row wrap">
          <LangBadge language={detail.language} />
          <StatusBadge status={detail.status} />
          <UrgencyBadge urgency={analysis?.urgency ?? detail.urgency} />
          {detail.lowConfidence && <span className="badge badge-warn">{t("queue.lowConfidence")}</span>}
        </div>
        <h1>{detail.letterType ? t(`letterType.${detail.letterType}` as MessageKey) : t("queue.typeUnknown")}</h1>
        <p className="muted small">
          <span dir="ltr">{detail.beneficiaryLabel}</span> · {formatDateTime(detail.receivedAt, uiLang)}
        </p>
      </header>

      {detail.status === "failed" && <p className="notice notice-error">{t("letter.failedNote")}</p>}

      {analysis?.reviewerWarnings.length ? (
        <div className="notice notice-warn" role="note">
          <strong>{t("letter.warnings")}</strong>
          <ul>
            {analysis.reviewerWarnings.map((w, i) => (
              <li key={i} lang="fr" dir="ltr">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.hasPhoto && can("letters.view_photo") && (
        <div className="card">
          <h2>{t("letter.photo")}</h2>
          <Photo id={detail.id} />
        </div>
      )}

      {analysis && (
        <div className="card">
          <h2>{t("letter.facts")}</h2>
          <dl className="facts">
            <dt>{t("letter.issuer")}</dt>
            <dd lang="fr" dir="ltr" className="start">{analysis.issuer ?? "—"}</dd>
            <dt>{t("letter.letterDate")}</dt>
            <dd>{analysis.letterDate ? <DeadlineText date={analysis.letterDate} /> : "—"}</dd>
            <dt>{t("queue.deadline")}</dt>
            <dd>
              {analysis.deadline ? (
                <>
                  <DeadlineText date={analysis.deadline.date} />
                  <br />
                  <span className="small muted">
                    {t(`deadlineKind.${analysis.deadline.kind}` as MessageKey)} ·{" "}
                    {analysis.deadline.explicit ? t("letter.deadlineExplicit") : t("letter.deadlineComputed")}
                  </span>
                  {!analysis.deadline.explicit && <div className="notice notice-warn small">{t("letter.deadlineCheck")}</div>}
                  <blockquote lang="fr" dir="ltr">{analysis.deadline.sourceQuote}</blockquote>
                </>
              ) : (
                t("queue.noDeadline")
              )}
            </dd>
            <dt>{t("letter.references")}</dt>
            <dd dir="ltr" className="start">
              {analysis.references.length ? analysis.references.join(" · ") : "—"}
            </dd>
            <dt>{t("letter.confidence")}</dt>
            <dd>{Math.round(analysis.confidence * 100)} %</dd>
          </dl>
        </div>
      )}

      {draft && (
        <div className="card">
          <h2>{t("letter.frText")}</h2>
          {detail.frEdited || dirty ? <p className="notice notice-info">{t("letter.retranslateNote")}</p> : null}
          <fieldset className="stack" disabled={!editable || busy} lang="fr" dir="ltr">
            <label className="field">
              <span>{t("letter.f.title")}</span>
              <textarea rows={2} value={draft.title} onChange={set("title")} />
            </label>
            <label className="field">
              <span>{t("letter.f.summary")}</span>
              <textarea rows={6} value={draft.summary} onChange={set("summary")} />
            </label>
            <label className="field">
              <span>{t("letter.f.actions")}</span>
              <textarea rows={4} value={draft.actions} onChange={set("actions")} />
              <small className="muted">{t("letter.f.onePerLine")}</small>
            </label>
            <label className="field">
              <span>{t("letter.f.orientation")}</span>
              <textarea rows={3} value={draft.orientation} onChange={set("orientation")} />
              <small className="muted">{t("letter.f.onePerLine")}</small>
            </label>
          </fieldset>
        </div>
      )}

      {detail.outgoingText && (
        <div className="card">
          <h2>{t("letter.outgoing", { language: target.nativeName })}</h2>
          <p className="muted small">{t("letter.outgoingHelp")}</p>
          <div className="outgoing long-text" lang={detail.language} dir={target.dir}>
            {detail.outgoingText}
          </div>
          {detail.outgoingTextFr && (
            <>
              <button type="button" className="btn btn-quiet" onClick={() => setShowFr(!showFr)} aria-expanded={showFr}>
                {showFr ? t("letter.hideFr") : t("letter.showFr")}
              </button>
              {showFr && (
                <div className="outgoing" lang="fr" dir="ltr">
                  {detail.outgoingTextFr}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {error ? (
        <p className="notice notice-error" role="alert">
          {errorCode(error) === "CONFLICT" ? t("letter.conflict") : t("error.generic")}
        </p>
      ) : null}
      {edit.isSuccess && !dirty && <p className="notice notice-ok">{t("letter.saved")}</p>}

      {editable && (
        <div className="actions-bar">
          {rejecting ? (
            <div className="stack">
              <label className="field">
                <span>{t("letter.rejectNote")}</span>
                <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <p className="muted small">{t("letter.rejectHelp")}</p>
              <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={() => reject.mutate({ id: detail.id, note: note.trim() || undefined })}>
                {t("letter.rejectConfirm")}
              </button>
              <button type="button" className="btn btn-block" onClick={() => setRejecting(false)}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-block" disabled={busy || invalid} onClick={() => void doApprove()}>
                {t("letter.approve")}
              </button>
              <button type="button" className="btn btn-block" disabled={busy || !dirty || invalid} onClick={save}>
                {t("letter.save")}
              </button>
              <button type="button" className="btn btn-danger-quiet btn-block" disabled={busy} onClick={() => setRejecting(true)}>
                {t("letter.reject")}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>{t("letter.history")}</h2>
        <ol className="history">
          {detail.history.map((h, i) => (
            <li key={i}>
              <strong>{t(`history.${h.action}` as MessageKey)}</strong>
              <span className="muted small">
                {" "}
                · {formatDateTime(h.at, uiLang)}
                {h.volunteerName ? ` · ${h.volunteerName}` : ""}
              </span>
              {h.note && <div className="small">{h.note}</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
