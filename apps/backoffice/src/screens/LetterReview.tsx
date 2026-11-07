import { LANGUAGES, LetterTypeSchema, type LetterAnalysis, type LetterDetail, type LetterText } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Chip, Countdown, DeadlineText, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { Icon, type IconName } from "../components/Icon";
import { BackLink, ConfirmSheet, ErrorBox, Skeleton, useObjectUrl, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { linesToList } from "../lib/format";
import { href, navigate } from "../lib/router";
import { relativeTime } from "../lib/relative";
import { useSession } from "../lib/session";
import { formatDate, formatDateTime } from "../lib/wilson-i18n";

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
      <BackLink to={href("queue")}>{t("letter.back")}</BackLink>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && <Review detail={query.data} />}
    </section>
  );
}

function Step({ n, title, action, children }: { n: number; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="step card">
      <header className="step-head">
        <span className="step-n" aria-hidden="true">
          {n}
        </span>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Viewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={t("letter.viewer")}>
      <div className="viewer-bar">
        <button type="button" className="icon-btn viewer-btn" onClick={() => setZoom(!zoom)} aria-label={t("letter.photoZoom")}>
          <Icon name="zoom" />
        </button>
        <button type="button" className="icon-btn viewer-btn" onClick={onClose} aria-label={t("common.close")} autoFocus>
          <Icon name="x" />
        </button>
      </div>
      <div className="viewer-scroll" onClick={() => setZoom(!zoom)}>
        <img className={zoom ? "is-zoom" : ""} src={url} alt={t("letter.photoAlt")} />
      </div>
    </div>
  );
}

function Photo({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useQuery({ ...orpc.letters.photo.queryOptions({ input: { id } }), retry: false, staleTime: Infinity });
  const url = useObjectUrl(q.data);
  const [open, setOpen] = useState(false);
  if (q.isPending) return <Skeleton lines={1} card={false} />;
  if (q.isError || !url) return <p className="muted">{t("letter.photoGone")}</p>;
  const isPdf = q.data?.type === "application/pdf";
  return isPdf ? (
    <a className="btn" href={url} target="_blank" rel="noreferrer">
      <Icon name="file" size={18} />
      {t("letter.openPdf")}
    </a>
  ) : (
    <>
      <button type="button" className="photo-button" onClick={() => setOpen(true)} aria-label={t("letter.photoZoom")}>
        <img src={url} alt={t("letter.photoAlt")} />
        <span className="photo-hint">
          <Icon name="zoom" size={16} />
          {t("letter.tapToOpen")}
        </span>
      </button>
      {open && <Viewer url={url} onClose={() => setOpen(false)} />}
    </>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-icon">
        <Icon name={icon} size={18} />
      </span>
      <div className="fact-body">
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function Review({ detail }: { detail: LetterDetail }) {
  const { t, lang: uiLang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
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
  const [fixing, setFixing] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
  const edit = useMutation({
    ...orpc.letters.edit.mutationOptions(),
    onSuccess: (d) => {
      refresh(d);
    },
  });
  const approve = useMutation({
    ...orpc.letters.approve.mutationOptions(),
    onSuccess: (d) => {
      refresh(d);
      toast(t("letter.sentToast"));
      navigate("queue");
    },
  });
  const reject = useMutation({
    ...orpc.letters.reject.mutationOptions(),
    onSuccess: (d) => {
      setRejecting(false);
      refresh(d);
      toast(t("letter.rejectedToast"), "info");
      navigate("queue");
    },
  });
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
    if (input)
      edit.mutate(input, {
        onSuccess: () => {
          toast(t("letter.savedToast"));
          setFixing(false);
        },
      });
  };
  const doApprove = async () => {
    setConfirming(false);
    const input = dirty ? buildEdit() : null;
    if (input) await edit.mutateAsync(input);
    approve.mutate({ id: detail.id });
  };

  const target = LANGUAGES[detail.language];
  const setF = <K extends keyof Facts>(k: K, v: Facts[K]) => setFacts((f) => (f ? { ...f, [k]: v } : f));
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));
  const urgency = analysis?.urgency ?? detail.urgency;
  const deadlineDate = analysis?.deadline?.date ?? detail.deadline;

  return (
    <div className={`stack${editable ? " has-actionbar" : ""}`}>
      <header className="review-head">
        <div className="chips">
          <LangBadge language={detail.language} />
          {detail.status !== "pending_review" && <StatusBadge status={detail.status} />}
          <UrgencyBadge urgency={urgency} />
          {detail.lowConfidence && (
            <Chip tone="warn" icon="eye">
              {t("queue.lowConfidence")}
            </Chip>
          )}
          {(detail.frEdited || factsChanged || textDirty) && (
            <Chip tone="info" icon="edit">
              {t("letter.edited")}
            </Chip>
          )}
        </div>
        <h1>{detail.letterType ? t(`letterType.${detail.letterType}` as MessageKey) : t("queue.typeUnknown")}</h1>
        <p className="muted small">
          <span dir="ltr">{detail.beneficiaryLabel}</span> · {relativeTime(detail.receivedAt, uiLang)}
        </p>
        {deadlineDate && (
          <div className={`deadline-banner${urgency === "high" ? " is-hot" : ""}`}>
            <Icon name="clock" size={22} />
            <div>
              <div className="deadline-label">{t("queue.deadline")}</div>
              <strong>{formatDate(deadlineDate, uiLang, { weekday: true })}</strong>
            </div>
            <Countdown date={deadlineDate} />
          </div>
        )}
      </header>

      {detail.status === "failed" && (
        <p className="notice notice-error">
          <Icon name="alert" />
          <span className="notice-body">{t("letter.failedNote")}</span>
        </p>
      )}
      {!editable && detail.status !== "failed" && (
        <p className="notice notice-info">
          <Icon name="info" />
          <span className="notice-body">{t("letter.readOnly")}</span>
        </p>
      )}

      {detail.hasPhoto && can("letters.view_photo") && (
        <Step n={1} title={t("letter.step1")}>
          <Photo id={detail.id} />
        </Step>
      )}

      {analysis && (
        <Step
          n={2}
          title={t("letter.step2")}
          action={
            editable && (
              <button type="button" className={`btn btn-small${fixing ? " btn-tonal" : ""}`} aria-expanded={fixing} onClick={() => setFixing(!fixing)}>
                <Icon name={fixing ? "x" : "edit"} size={16} />
                {fixing ? t("common.close") : t("letter.fix")}
              </button>
            )
          }
        >
          {analysis.reviewerWarnings.length > 0 && (
            <div className="callout" role="note">
              <Icon name="alert" size={20} />
              <div>
                <strong>{t("letter.warnings")}</strong>
                <ul>
                  {analysis.reviewerWarnings.map((w, i) => (
                    <li key={i} lang="fr" dir="ltr" className="start">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <dl className="facts">
            <Fact icon="building" label={t("letter.issuer")}>
              <span lang="fr" dir="ltr" className="start">
                {analysis.issuer ?? "—"}
              </span>
            </Fact>
            <Fact icon="calendar" label={t("letter.letterDate")}>
              {analysis.letterDate ? formatDate(analysis.letterDate, uiLang, { weekday: true }) : "—"}
            </Fact>
            <Fact icon="clock" label={t("queue.deadline")}>
              {analysis.deadline ? (
                <>
                  <DeadlineText date={analysis.deadline.date} />
                  <div className="small muted">
                    {t(`deadlineKind.${analysis.deadline.kind}` as MessageKey)} · {analysis.deadline.explicit ? t("letter.deadlineExplicit") : t("letter.deadlineComputed")}
                  </div>
                  {!analysis.deadline.explicit && (
                    <div className="callout callout-small">
                      <Icon name="alert" size={16} />
                      <span>{t("letter.deadlineCheck")}</span>
                    </div>
                  )}
                  <blockquote lang="fr" dir="ltr">
                    {analysis.deadline.sourceQuote}
                  </blockquote>
                </>
              ) : (
                t("queue.noDeadline")
              )}
            </Fact>
            <Fact icon="hash" label={t("letter.references")}>
              <span dir="ltr" className="start">
                {analysis.references.length ? analysis.references.join(" · ") : "—"}
              </span>
            </Fact>
            <Fact icon="shield" label={t("letter.confidence")}>
              <span className="confidence">
                <span className="meter" aria-hidden="true">
                  <span style={{ inlineSize: `${Math.round(analysis.confidence * 100)}%` }} />
                </span>
                <span>
                  <strong>{Math.round(analysis.confidence * 100)} %</strong> <span className="muted">· {analysis.confidence < 0.7 ? t("letter.confidenceLow") : t("letter.confidenceOk")}</span>
                </span>
              </span>
            </Fact>
          </dl>

          <div className="fr-explain" lang="fr" dir="ltr">
            <h3>{(draft ?? original)?.title}</h3>
            <p>{(draft ?? original)?.summary}</p>
            {linesToList((draft ?? original)?.actions ?? "").length > 0 && (
              <ul>
                {linesToList((draft ?? original)?.actions ?? "").map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </div>

          {fixing && facts && draft && editable && (
            <div className="fix-panel">
              <h3>{t("letter.fixTitle")}</h3>
              <fieldset className="stack" disabled={busy}>
                <legend className="fix-legend">{t("letter.fixInfo")}</legend>
                <label className="field">
                  <span className="field-label">{t("letter.f.type")}</span>
                  <select value={facts.letterType} onChange={(e) => setF("letterType", e.target.value as Facts["letterType"])}>
                    {LetterTypeSchema.options.map((type) => (
                      <option key={type} value={type}>
                        {t(`letterType.${type}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t("letter.f.urgency")}</span>
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
                      <span className="field-label">{t("letter.f.deadlineKind")}</span>
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
              <fieldset className="stack" disabled={busy} lang="fr" dir="ltr">
                <legend className="fix-legend">{t("letter.fixText")}</legend>
                {detail.frEdited || textDirty ? (
                  <p className="notice notice-info">
                    <Icon name="info" />
                    <span className="notice-body">{t("letter.retranslateNote")}</span>
                  </p>
                ) : null}
                <label className="field">
                  <span className="field-label">{t("letter.f.title")}</span>
                  <textarea rows={2} value={draft.title} onChange={set("title")} />
                </label>
                <label className="field">
                  <span className="field-label">{t("letter.f.summary")}</span>
                  <textarea rows={6} value={draft.summary} onChange={set("summary")} />
                </label>
                <label className="field">
                  <span className="field-label">{t("letter.f.actions")}</span>
                  <textarea rows={4} value={draft.actions} onChange={set("actions")} />
                  <small className="muted">{t("letter.f.onePerLine")}</small>
                </label>
                <label className="field">
                  <span className="field-label">{t("letter.f.orientation")}</span>
                  <textarea rows={3} value={draft.orientation} onChange={set("orientation")} />
                  <small className="muted">{t("letter.f.onePerLine")}</small>
                </label>
              </fieldset>
              <button type="button" className="btn btn-primary btn-block" disabled={busy || !dirty || invalid} onClick={save}>
                <Icon name="check" size={18} />
                {t("letter.save")}
              </button>
            </div>
          )}
        </Step>
      )}

      {detail.outgoingText && (
        <Step n={3} title={t("letter.step3")}>
          <p className="muted small">{t("letter.outgoingHelp")}</p>
          <div className="wa-thread">
            <div className="wa-label" lang={detail.language}>
              <Icon name="phone" size={14} />
              <span lang={uiLang}>{t("letter.bubbleLang", { language: target.nativeName })}</span>
            </div>
            <div className="wa-bubble long-text" lang={detail.language} dir={target.dir}>
              {detail.outgoingText}
            </div>
            {showFr && detail.outgoingTextFr && (
              <div className="wa-bubble wa-bubble-fr" lang="fr" dir="ltr">
                {detail.outgoingTextFr}
              </div>
            )}
            {detail.outgoingDetailsText && (
              <>
                <div className="wa-label">
                  <Icon name="info" size={14} />
                  <span>{t("letter.detailsLabel")}</span>
                </div>
                <div className="wa-bubble long-text" lang={detail.language} dir={target.dir}>
                  {detail.outgoingDetailsText}
                </div>
                {showFr && detail.outgoingDetailsTextFr && (
                  <div className="wa-bubble wa-bubble-fr" lang="fr" dir="ltr">
                    {detail.outgoingDetailsTextFr}
                  </div>
                )}
              </>
            )}
          </div>
          {detail.outgoingTextFr && (
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setShowFr(!showFr)} aria-expanded={showFr}>
              <Icon name={showFr ? "eyeOff" : "eye"} size={16} />
              {showFr ? t("letter.hideFr") : t("letter.showFr")}
            </button>
          )}
        </Step>
      )}

      {error ? (
        <p className="notice notice-error" role="alert">
          <Icon name="alert" />
          <span className="notice-body">{errorCode(error) === "CONFLICT" ? t("letter.conflict") : t("error.generic")}</span>
        </p>
      ) : null}

      {analysis?.sources?.length ? (
        <details className="card fold">
          <summary>
            <Icon name="book" size={18} />
            {t("letter.sources")}
          </summary>
          <p className="muted small">{t("letter.sourcesNote")}</p>
          <ul>
            {analysis.sources.map((s) => (
              <li key={s.chunkId}>
                <span lang="fr" dir="ltr">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </span>
                <span className="muted small"> · {t(`knowledge.source.${s.sourceId}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="card fold">
        <summary>
          <Icon name="clock" size={18} />
          {t("letter.history")}
        </summary>
        <ol className="timeline">
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
      </details>

      {editable && (
        <div className="actionbar">
          <div className="actionbar-inner">
            <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={() => setRejecting(true)}>
              {t("letter.reject.short")}
            </button>
            <button type="button" className="btn btn-primary btn-grow" disabled={busy || invalid} onClick={() => setConfirming(true)}>
              <Icon name="send" size={18} />
              {t("letter.approve")}
            </button>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={confirming}
        title={t("letter.confirmApprove")}
        body={t("letter.confirmBody", { language: target.nativeName })}
        confirmLabel={t("letter.confirmYes")}
        busy={busy}
        onConfirm={() => void doApprove()}
        onClose={() => setConfirming(false)}
      />
      <ConfirmSheet
        open={rejecting}
        title={t("letter.rejectTitle")}
        body={t("letter.rejectHelp")}
        confirmLabel={t("letter.rejectConfirm")}
        tone="danger"
        busy={busy}
        onConfirm={() => reject.mutate({ id: detail.id, note: note.trim() || undefined })}
        onClose={() => setRejecting(false)}
      >
        <label className="field">
          <span className="field-label">
            {t("letter.rejectNote")}
          </span>
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ConfirmSheet>
    </div>
  );
}
