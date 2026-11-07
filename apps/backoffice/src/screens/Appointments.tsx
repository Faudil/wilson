import type { Appointment, Slot } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { client, errorCode, orpc } from "../lib/api";
import { addDays, parisParts, parisToIso, todayParis } from "../lib/format";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { documentTypeName, formatDate } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

type Tab = "open" | "mine" | "slots" | "all";
type T = ReturnType<typeof useI18n>["t"];

/** "jeudi 12 novembre 2026 · 14:00" in Paris time. */
function useWhen() {
  const { lang } = useI18n();
  return (iso: string) => {
    const p = parisParts(iso);
    return `${formatDate(p.date, lang, { weekday: true })} · ${p.time}`;
  };
}

/** Calendar file with alarms the day before and 2 hours before: the volunteer's own reminder, on their phone. */
function downloadIcs(a: Appointment, t: T) {
  if (!a.startsAt) return;
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const summary = esc(t("appt.ics.summary", { topic: t(`appt.topic.${a.topic}` as MessageKey) }));
  const alarm = (trigger: string) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${summary}`, `TRIGGER:${trigger}`, "END:VALARM"];
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wilson//Rendez-vous//FR", "BEGIN:VEVENT",
    `UID:${a.id}@wilson`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(a.startsAt)}`, `DURATION:PT${a.durationMin}M`,
    `SUMMARY:${summary}`,
    ...(a.meetingPoint ? [`LOCATION:${esc(a.meetingPoint)}`] : []),
    ...alarm("-P1D"), ...alarm("-PT2H"),
    "END:VEVENT", "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `rendez-vous-${a.id.slice(0, 8)}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function errorText(error: unknown, t: T): string {
  const reason = errorCode(error) === "CONFLICT" ? ((error as { data?: { reason?: string } }).data?.reason ?? "") : "";
  const known: Record<string, MessageKey> = { taken: "appt.error.taken", past: "appt.error.past", time_required: "appt.error.timeRequired", booked: "appt.error.booked" };
  return t(known[reason] ?? "error.generic");
}

export function Appointments() {
  const { t } = useI18n();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("open");
  const counts = useQuery({ ...orpc.appointments.counts.queryOptions(), refetchInterval: 60_000 });
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "open", label: t("appt.tab.open"), count: counts.data?.open },
    { value: "mine", label: t("appt.tab.mine"), count: counts.data?.mineSoon },
    ...(can("appointments.slots") ? [{ value: "slots" as const, label: t("appt.tab.slots") }] : []),
    ...(can("appointments.manage") ? [{ value: "all" as const, label: t("appt.tab.all") }] : []),
  ];
  return (
    <section className="stack">
      <div>
        <h1>{t("appt.title")}</h1>
        <p className="muted">{t("appt.intro")}</p>
      </div>
      <Segmented label={t("appt.title")} value={tab} onChange={setTab} options={tabs} />
      {tab === "slots" ? <Slots /> : <AppointmentList view={tab} />}
    </section>
  );
}

type Dialog = { kind: "accept" | "release" | "cancel" | "documents"; a: Appointment } | null;

function AppointmentList({ view }: { view: "open" | "mine" | "all" }) {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const when = useWhen();
  const list = useQuery({ ...orpc.appointments.list.queryOptions({ input: { view } }), refetchInterval: 60_000 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const done = (message: MessageKey) => () => {
    toast(t(message));
    setDialog(null);
    void qc.invalidateQueries({ queryKey: orpc.appointments.key() });
  };
  const complete = useMutation({ ...orpc.appointments.complete.mutationOptions(), onSuccess: done("appt.savedToast") });
  const release = useMutation({ ...orpc.appointments.release.mutationOptions(), onSuccess: done("appt.savedToast") });
  const cancel = useMutation({ ...orpc.appointments.cancel.mutationOptions(), onSuccess: done("appt.savedToast") });
  const error = complete.error ?? release.error ?? cancel.error;
  const items = list.data ?? [];

  return (
    <>
      {list.isPending && <Skeleton lines={3} />}
      {list.isError && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
      {error && <p className="notice notice-error small">{errorText(error, t)}</p>}
      {list.isSuccess && items.length === 0 && (
        <Empty art="calendar" sub={view === "open" ? t("appt.emptySub.open") : undefined}>
          {t(`appt.empty.${view}` as MessageKey)}
        </Empty>
      )}
      <ul className="cards">
        {items.map((a) => {
          const active = a.status === "accepted";
          return (
            <li key={a.id}>
              <div className={`card${a.status === "open" ? " is-attention" : ""}`}>
                <div className="card-top">
                  <strong className="card-title">
                    <Icon name={a.kind === "accompaniment" ? "user" : "file"} size={18} /> {t(`appt.topic.${a.topic}` as MessageKey)}
                  </strong>
                  <LangBadge language={a.language} />
                </div>
                <span className="card-kicker">
                  <Icon name="calendar" size={16} />
                  {a.startsAt ? when(a.startsAt) : t("appt.noTime")}
                </span>
                {(a.meetingPoint ?? a.city) && (
                  <span className="card-kicker" dir="auto">
                    <Icon name="building" size={16} />
                    {a.meetingPoint ?? a.city}
                  </span>
                )}
                <div className="chips">
                  <Chip tone={a.status === "open" ? "warn" : a.status === "accepted" ? "ok" : "muted"}>{t(`appt.status.${a.status}` as MessageKey)}</Chip>
                  <Chip tone="muted">{t(`appt.kind.${a.kind}` as MessageKey)}</Chip>
                  {a.kind === "form_session" && <Chip tone={a.documentsConsent ? "info" : "muted"} icon="paperclip">{t(a.documentsConsent ? "appt.consent" : "appt.noConsent")}</Chip>}
                  {a.volunteerName && !a.mine && <Chip tone="muted" icon="user">{t("appt.with", { name: a.volunteerName })}</Chip>}
                </div>
                {a.beneficiaryLabel && (
                  <p className="muted small" dir="ltr">
                    {t("appt.person", { label: a.beneficiaryLabel })}
                  </p>
                )}
                <div className="row wrap">
                  {a.status === "open" && can("appointments.accept") && (
                    <button type="button" className="btn btn-primary btn-small" onClick={() => setDialog({ kind: "accept", a })}>
                      <Icon name="hand" size={16} />
                      {t("appt.accept")}
                    </button>
                  )}
                  {active && a.mine && a.startsAt && (
                    <button type="button" className="btn btn-small" onClick={() => downloadIcs(a, t)}>
                      <Icon name="bell" size={16} />
                      {t("appt.calendar")}
                    </button>
                  )}
                  {active && a.canOpenDocuments && (
                    <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: "documents", a })}>
                      <Icon name="paperclip" size={16} />
                      {t("appt.documents")}
                    </button>
                  )}
                  {a.beneficiaryId && can("conversations.view") && (
                    <a className="btn btn-small btn-quiet" href={href("conversations", a.beneficiaryId)}>
                      <Icon name="chat" size={16} />
                      {t("appt.conversation")}
                    </a>
                  )}
                  {active && (a.mine || can("appointments.manage")) && can("appointments.accept") && (
                    <>
                      <button type="button" className="btn btn-small btn-quiet" disabled={complete.isPending} onClick={() => complete.mutate({ id: a.id })}>
                        <Icon name="check" size={16} />
                        {t("appt.complete")}
                      </button>
                      <button type="button" className="btn btn-small btn-danger-quiet" onClick={() => setDialog({ kind: "release", a })}>
                        <Icon name="undo" size={16} />
                        {t("appt.release")}
                      </button>
                    </>
                  )}
                  {(a.status === "open" || active) && can("appointments.manage") && (
                    <button type="button" className="btn btn-small btn-danger-quiet" onClick={() => setDialog({ kind: "cancel", a })}>
                      <Icon name="x" size={16} />
                      {t("appt.cancel")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {dialog?.kind === "accept" && <AcceptSheet a={dialog.a} onClose={() => setDialog(null)} onDone={done("appt.acceptedToast")} />}
      {dialog?.kind === "documents" && <DocumentsSheet a={dialog.a} onClose={() => setDialog(null)} />}
      <ConfirmSheet
        open={dialog?.kind === "release"}
        title={t("appt.releaseTitle")}
        body={t("appt.releaseBody")}
        confirmLabel={t("appt.release")}
        tone="danger"
        busy={release.isPending}
        onConfirm={() => dialog && release.mutate({ id: dialog.a.id })}
        onClose={() => setDialog(null)}
      />
      <ConfirmSheet
        open={dialog?.kind === "cancel"}
        title={t("appt.cancel")}
        body={t("appt.cancelBody")}
        confirmLabel={t("appt.cancel")}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => dialog && cancel.mutate({ id: dialog.a.id })}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function AcceptSheet({ a, onClose, onDone }: { a: Appointment; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [meetingPoint, setMeetingPoint] = useState("");
  const [date, setDate] = useState(addDays(todayParis(), 2));
  const [time, setTime] = useState("14:00");
  const accept = useMutation({ ...orpc.appointments.accept.mutationOptions(), onSuccess: onDone });
  const needsTime = !a.startsAt;
  const startsAt = needsTime ? parisToIso(date, time) : undefined;
  const ok = meetingPoint.trim().length >= 2 && (!needsTime || !!startsAt);
  return (
    <Sheet open onClose={onClose} title={t("appt.acceptTitle")}>
      <div className="stack">
        <p className="sheet-text">{t("appt.acceptBody")}</p>
        {needsTime && (
          <>
            <DateField label={t("appt.date")} value={date} onChange={setDate} previewKey="appt.datePreview" />
            <label className="field">
              <span className="field-label">{t("appt.time")}</span>
              <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} dir="ltr" />
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">{t("appt.meetingPointLabel")}</span>
          <input value={meetingPoint} maxLength={160} onChange={(e) => setMeetingPoint(e.target.value)} placeholder={t("appt.meetingPointHint")} dir="auto" />
        </label>
        {accept.isError && <p className="notice notice-error small">{errorText(accept.error, t)}</p>}
        <div className="stack-tight">
          <button type="button" className="btn btn-block btn-primary" disabled={!ok || accept.isPending} onClick={() => accept.mutate({ id: a.id, meetingPoint: meetingPoint.trim(), ...(startsAt ? { startsAt } : {}) })}>
            {t("appt.accept")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function DocumentsSheet({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const { t, lang } = useI18n();
  const docs = useQuery({ ...orpc.appointments.documents.queryOptions({ input: { id: a.id } }), staleTime: 0 });
  const [fileError, setFileError] = useState(false);
  const open = async (documentId: string) => {
    setFileError(false);
    try {
      const file = await client.appointments.documentFile({ id: a.id, documentId });
      const url = URL.createObjectURL(file);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFileError(true);
    }
  };
  return (
    <Sheet open onClose={onClose} title={t("appt.documentsTitle")}>
      <div className="stack">
        <div className="notice notice-info small">
          <Icon name="shield" size={16} />
          <span className="notice-body">{t("appt.documentsBody")}</span>
        </div>
        {docs.isPending && <Skeleton lines={2} card={false} />}
        {docs.isError && <ErrorBox error={docs.error} />}
        {docs.isSuccess && docs.data.length === 0 && <p className="muted">{t("appt.noDocuments")}</p>}
        <ul className="cards">
          {docs.data?.map((d) => (
            <li key={d.id} className="card row between">
              <span>
                <strong>{d.label ?? documentTypeName(d.type, lang)}</strong>
                {d.expiresAt && <span className="muted small"> · {formatDate(d.expiresAt, lang)}</span>}
              </span>
              <button type="button" className="btn btn-small" onClick={() => void open(d.id)}>
                <Icon name="eye" size={16} />
                {t("appt.open")}
              </button>
            </li>
          ))}
        </ul>
        {fileError && <p className="notice notice-error small">{t("error.generic")}</p>}
      </div>
    </Sheet>
  );
}

function Slots() {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const when = useWhen();
  const slots = useQuery(orpc.appointments.slots.queryOptions({ input: { scope: "mine" } }));
  const [date, setDate] = useState(addDays(todayParis(), 2));
  const [time, setTime] = useState("14:00");
  const [duration, setDuration] = useState(60);
  const [place, setPlace] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.appointments.key() });
  const add = useMutation({ ...orpc.appointments.addSlot.mutationOptions(), onSuccess: () => { toast(t("appt.slots.addedToast")); refresh(); } });
  const remove = useMutation({ ...orpc.appointments.removeSlot.mutationOptions(), onSuccess: refresh });
  const startsAt = parisToIso(date, time);
  const ok = !!startsAt && place.trim().length >= 2;
  const items: Slot[] = slots.data ?? [];
  if (!can("appointments.slots")) return null;
  return (
    <div className="stack">
      <div className="card stack">
        <h2 className="section-title">{t("appt.slots.title")}</h2>
        <p className="muted small">{t("appt.slots.intro")}</p>
        <DateField label={t("appt.date")} value={date} onChange={setDate} previewKey="appt.datePreview" />
        <div className="row wrap">
          <label className="field">
            <span className="field-label">{t("appt.time")}</span>
            <input type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t("appt.slots.duration")}</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {t("appt.slots.minutes", { n })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("appt.slots.place")}</span>
          <input value={place} maxLength={160} onChange={(e) => setPlace(e.target.value)} placeholder={t("appt.slots.placeHint")} dir="auto" />
        </label>
        {add.isError && <p className="notice notice-error small">{errorText(add.error, t)}</p>}
        <button type="button" className="btn btn-primary" disabled={!ok || add.isPending} onClick={() => startsAt && add.mutate({ startsAt, durationMin: duration, place: place.trim() })}>
          <Icon name="plus" size={16} />
          {t("appt.slots.add")}
        </button>
      </div>
      {slots.isPending && <Skeleton lines={2} />}
      {slots.isError && <ErrorBox error={slots.error} retry={() => void slots.refetch()} />}
      {slots.isSuccess && items.length === 0 && <Empty art="calendar">{t("appt.slots.empty")}</Empty>}
      {remove.isError && <p className="notice notice-error small">{errorText(remove.error, t)}</p>}
      <ul className="cards">
        {items.map((s) => (
          <li key={s.id}>
            <div className="card row between">
              <span className="stack-tight">
                <strong>{when(s.startsAt)}</strong>
                <span className="muted small" dir="auto">
                  {s.place} · {t("appt.slots.minutes", { n: s.durationMin })}
                </span>
                <span>
                  <Chip tone={s.booked ? "ok" : "muted"}>{t(s.booked ? "appt.slots.booked" : "appt.slots.free")}</Chip>
                </span>
              </span>
              {!s.booked && (
                <button type="button" className="btn btn-small btn-danger-quiet" disabled={remove.isPending} onClick={() => remove.mutate({ id: s.id })} aria-label={t("appt.slots.remove")}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
