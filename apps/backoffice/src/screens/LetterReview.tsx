import { LANGUAGES, LetterTypeSchema, type LetterAnalysis, type LetterDetail, type LetterText } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DeadlineText, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { DateField } from "../components/DateField";
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

type Facts = {
  letterType: LetterAnalysis["letterType"];
  urgency: LetterAnalysis["urgency"];
  noDeadline: boolean;
  date: string;
  kind: NonNullable<LetterAnalysis["deadline"]>["kind"];
  explicit: boolean;
};
const DEADLINE_KINDS = ["reply", "appointment", "appeal", "payment", "other"] as const;
const URGENCIES = ["low", "medium", "high"] as const;

const toFacts = (a: LetterAnalysis): Facts => ({
  letterType: a.letterType,
  urgency: a.urgency,
  noDeadline: a.deadline === null,
  date: a.deadline?.date ?? "",
  kind: a.deadline?.kind ?? "reply",
  explicit: a.deadline?.explicit ?? true,
});
const factsDirty = (f: Facts, o: Facts): boolean =>
  f.letterType !== o.letterType ||
  f.urgency !== o.urgency ||
  f.noDeadline !== o.noDeadline ||
  (!f.noDeadline && (f.date !== o.date || f.kind !== o.kind || f.explicit !== o.explicit));

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
  const originalFacts = useMemo(() => (analysis ? toFacts(analysis) : null), [analysis]);
  const [facts, setFacts] = useState<Facts | null>(originalFacts);
  useEffect(() => {
    setFacts(originalFacts);
  }, [originalFacts]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [showFr, setShowFr] = useState(false);

  const textDirty = !!draft && !!original && (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== original[k]);
  const factsChanged = !!facts && !!originalFacts && factsDirty(facts, originalFacts);
  const dirty = textDirty || factsChanged;
  const parsed = draft ? fromDraft(draft) : null;
  const invalid =
    (!!facts && !facts.noDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(facts.date)) ||
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

  /** Only the fields the volunteer changed are sent. */
  const buildEdit = () => {
    if (!parsed) return null;
    const out: Parameters<typeof edit.mutate>[0] = { id: detail.id };
    if (textDirty) out.fr = parsed;
    if (facts && originalFacts && analysis && factsChanged) {
      if (facts.letterType !== originalFacts.letterType) out.letterType = facts.letterType;
      if (facts.urgency !== originalFacts.urgency) out.urgency = facts.urgency;
      if (facts.noDeadline !== originalFacts.noDeadline || facts.date !== originalFacts.date || facts.kind !== originalFacts.kind || facts.explicit !== originalFacts.explicit) {
        out.deadline = facts.noDeadline
          ? null
          : { date: facts.date, kind: facts.kind, explicit: facts.explicit, sourceQuote: analysis.deadline?.sourceQuote ?? "" };
      }
    }
    return out;
  };
  const save = () => {
    const input = buildEdit();
    if (input) edit.mutate(input);
  };
  const doApprove = async () => {
    if (!window.confirm(t("letter.confirmApprove"))) return;
    const input = dirty ? buildEdit() : null;
    if (input) await edit.mutateAsync(input);
    approve.mutate({ id: detail.id });
  };

  const target = LANGUAGES[detail.language];
  const setF = <K extends keyof Facts>(k: K, v: Facts[K]) => setFacts((f) => (f ? { ...f, [k]: v } : f));
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

      {facts && editable && (
        <div className="card">
          <h2>{t("letter.editFacts")}</h2>
          <fieldset className="stack" disabled={busy}>
            <label className="field">
              <span>{t("letter.f.type")}</span>
              <select value={facts.letterType} onChange={(e) => setF("letterType", e.target.value as Facts["letterType"])}>
                {LetterTypeSchema.options.map((type) => (
                  <option key={type} value={type}>
                    {t(`letterType.${type}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("letter.f.urgency")}</span>
              <select value={facts.urgency} onChange={(e) => setF("urgency", e.target.value as Facts["urgency"])}>
                {URGENCIES.map((u) => (
                  <option key={u} value={u}>
                    {t(`urgency.${u}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={facts.noDeadline} onChange={(e) => setF("noDeadline", e.target.checked)} />
              <span>{t("letter.f.noDeadline")}</span>
            </label>
            {!facts.noDeadline && (
              <>
                <DateField label={t("letter.f.deadlineDate")} value={facts.date} onChange={(v) => setF("date", v)} previewKey="letter.f.datePreview" />
                <label className="field">
                  <span>{t("letter.f.deadlineKind")}</span>
                  <select value={facts.kind} onChange={(e) => setF("kind", e.target.value as Facts["kind"])}>
                    {DEADLINE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`deadlineKind.${k}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={facts.explicit} onChange={(e) => setF("explicit", e.target.checked)} />
                  <span>{t("letter.f.explicit")}</span>
                </label>
              </>
            )}
          </fieldset>
        </div>
      )}

      {draft && (
        <div className="card">
          <h2>{t("letter.frText")}</h2>
          {detail.frEdited || textDirty ? <p className="notice notice-info">{t("letter.retranslateNote")}</p> : null}
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
