import type { Event, EventInput, EventKind, LanguageCode, VolunteerSkill } from "@wilson/contracts";
import { EVENT_KINDS, LANGUAGES, LANGUAGE_CODES, VOLUNTEER_SKILLS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { EVENT_EMOJI } from "../components/EventsCard";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

type T = ReturnType<typeof useI18n>["t"];
type Scope = "upcoming" | "mine" | "past";

const OTHER_LANGUAGES = LANGUAGE_CODES.filter((c) => c !== "fr");

function errorText(error: unknown, t: T): string | null {
  if (!error) return null;
  const reason = errorCode(error) === "CONFLICT" ? ((error as { data?: { reason?: string } }).data?.reason ?? "") : "";
  const known: Record<string, MessageKey> = { past: "ev.error.past", cancelled: "ev.error.cancelled" };
  return t(known[reason] ?? "error.generic");
}

const hours = (e: Event) => (e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime);

/** Calendar file with an alarm the day before and 2 hours before. */
function downloadIcs(e: Event) {
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const alarm = (trigger: string) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${trigger}`, "END:VALARM"];
  const end = e.endsAt ?? new Date(Date.parse(e.startsAt) + 2 * 3_600_000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wilson//Agenda//FR", "BEGIN:VEVENT",
    `UID:${e.id}@wilson`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(e.startsAt)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.place ? [`LOCATION:${esc(e.place)}`] : []),
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...alarm("-P1D"), ...alarm("-PT2H"),
    "END:VEVENT", "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `agenda-${e.date}-${e.id.slice(0, 6)}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "3 / 6" or "3" when there is no limit. */
const spots = (n: number, limit: number | null) => (limit === null ? String(n) : `${n} / ${limit}`);

// ------------------------------------------------------------------------------------------------ form

type Draft = {
  kind: EventKind; title: string; description: string; place: string; date: string; startTime: string; endTime: string;
  volunteerSpots: string; public: boolean; publicSpots: string; languages: LanguageCode[]; skills: VolunteerSkill[]; associationId: string;
};
const empty = (date: string): Draft => ({
  kind: "maraude", title: "", description: "", place: "", date, startTime: "19:00", endTime: "", volunteerSpots: "", public: false, publicSpots: "", languages: [], skills: [], associationId: "",
});
const fromEvent = (e: Event): Draft => ({
  kind: e.kind, title: e.title, description: e.description ?? "", place: e.place ?? "", date: e.date, startTime: e.startTime, endTime: e.endTime ?? "",
  volunteerSpots: e.volunteerSpots?.toString() ?? "", public: e.public, publicSpots: e.publicSpots?.toString() ?? "", languages: e.languages, skills: e.skills, associationId: e.association?.id ?? "",
});
const num = (s: string) => (s.trim() ? Number(s) : null);
const toInput = (d: Draft): EventInput => ({
  kind: d.kind, title: d.title.trim(), description: d.description.trim() || null, place: d.place.trim() || null, date: d.date,
  startTime: d.startTime, endTime: d.endTime || null, volunteerSpots: num(d.volunteerSpots), public: d.public, publicSpots: d.public ? num(d.publicSpots) : null,
  languages: d.languages, skills: d.skills, associationId: d.associationId || null,
});
const toggle = <X,>(xs: X[], x: X) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

function EventSheet({ edit, date, onClose }: { edit: Event | null; date: string; onClose: () => void }) {
  const { t } = useI18n();
  const { can, volunteer } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(edit ? fromEvent(edit) : empty(date));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const global = can("associations.manage");
  const assocs = useQuery({ ...orpc.associations.list.queryOptions(), enabled: global && !edit });
  const done = () => {
    toast(t("ev.savedToast"));
    void qc.invalidateQueries({ queryKey: orpc.events.key() });
    onClose();
  };
  const create = useMutation({ ...orpc.events.create.mutationOptions(), onSuccess: done });
  const update = useMutation({ ...orpc.events.update.mutationOptions(), onSuccess: done });
  const spotsOk = (s: string) => !s.trim() || (/^\d+$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 500);
  const timesOk = /^\d\d:\d\d$/.test(d.startTime) && (!d.endTime || d.endTime > d.startTime);
  const valid = d.title.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && timesOk && spotsOk(d.volunteerSpots) && spotsOk(d.publicSpots);
  const error = create.error ?? update.error;
  return (
    <Sheet open onClose={onClose} title={edit ? t("ev.edit") : t("ev.add")} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (edit) update.mutate({ id: edit.id, event: toInput(d) });
          else create.mutate(toInput(d));
        }}
      >
        <div className="field">
          <span className="field-label">{t("ev.kind")}</span>
          <div className="kind-picker" role="radiogroup" aria-label={t("ev.kind")}>
            {EVENT_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={`kind-option${d.kind === k ? " is-active" : ""}`} onClick={() => set("kind", k)}>
                <span aria-hidden="true">{EVENT_EMOJI[k]}</span>
                {t(`ev.kind.${k}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">{t("ev.titleLabel")}</span>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder={t("ev.titlePlaceholder")} maxLength={120} lang="fr" dir="auto" required />
        </label>
        <DateField label={t("ev.date")} value={d.date} onChange={(v) => set("date", v)} previewKey="ev.datePreview" />
        <div className="row wrap form-pair">
          <label className="field">
            <span className="field-label">{t("ev.startTime")}</span>
            <input type="time" value={d.startTime} onChange={(e) => set("startTime", e.target.value)} dir="ltr" required />
          </label>
          <label className="field">
            <span className="field-label">{t("ev.endTime")} <span className="muted small">{t("common.optional")}</span></span>
            <input type="time" value={d.endTime} onChange={(e) => set("endTime", e.target.value)} dir="ltr" />
          </label>
        </div>
        {d.endTime && d.endTime <= d.startTime && <p className="notice notice-error"><Icon name="alert" size={20} /><span className="notice-body">{t("ev.endBeforeStart")}</span></p>}
        <label className="field">
          <span className="field-label">{t("ev.place")} <span className="muted small">{t("common.optional")}</span></span>
          <input value={d.place} onChange={(e) => set("place", e.target.value)} placeholder={t("ev.placePlaceholder")} maxLength={200} dir="auto" />
        </label>
        <label className="field">
          <span className="field-label">{t("ev.description")} <span className="muted small">{t("common.optional")}</span></span>
          <textarea value={d.description} onChange={(e) => set("description", e.target.value)} placeholder={t("ev.descriptionPlaceholder")} maxLength={1000} rows={3} lang="fr" dir="auto" />
        </label>
        <label className="field">
          <span className="field-label">{t("ev.volunteerSpots")} <span className="muted small">{t("common.optional")}</span></span>
          <input inputMode="numeric" value={d.volunteerSpots} onChange={(e) => set("volunteerSpots", e.target.value)} placeholder={t("ev.noLimit")} dir="ltr" />
          <small className="muted">{t("ev.spotsHelp")}</small>
        </label>

        <fieldset className="stack-tight">
          <legend className="field-label">{t("ev.wanted")} <span className="muted small">{t("common.optional")}</span></legend>
          <small className="muted">{t("ev.wantedHelp")}</small>
          <div className="toggle-chips">
            {OTHER_LANGUAGES.map((code) => (
              <button key={code} type="button" aria-pressed={d.languages.includes(code)} className="toggle-chip" lang={code} dir={LANGUAGES[code].dir} onClick={() => set("languages", toggle(d.languages, code))}>
                {LANGUAGES[code].nativeName}
              </button>
            ))}
          </div>
          <div className="toggle-chips">
            {VOLUNTEER_SKILLS.map((s) => (
              <button key={s} type="button" aria-pressed={d.skills.includes(s)} className="toggle-chip" onClick={() => set("skills", toggle(d.skills, s))}>
                {t(`skill.${s}` as MessageKey)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="check">
          <input type="checkbox" checked={d.public} onChange={(e) => set("public", e.target.checked)} />
          <span>
            {t("ev.public")}
            <small className="muted block">{t("ev.publicHelp")}</small>
          </span>
        </label>
        {d.public && (
          <label className="field">
            <span className="field-label">{t("ev.publicSpots")} <span className="muted small">{t("common.optional")}</span></span>
            <input inputMode="numeric" value={d.publicSpots} onChange={(e) => set("publicSpots", e.target.value)} placeholder={t("ev.noLimit")} dir="ltr" />
          </label>
        )}

        {!edit && global && (
          <label className="field">
            <span className="field-label">{t("ev.audience")}</span>
            <select value={d.associationId} onChange={(e) => set("associationId", e.target.value)}>
              <option value="">{t("ev.audience.all")}</option>
              {assocs.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {!edit && !global && <p className="muted small">{volunteer.association ? t("ev.audience.own", { name: volunteer.association.name }) : t("ev.audience.allShort")}</p>}

        {error && <p className="notice notice-error small">{errorText(error, t)}</p>}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || create.isPending || update.isPending}>
            {edit ? t("vol.save") : t("ev.publish")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------------------------------- detail

function PreviewBlock({ id }: { id: string }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<LanguageCode>("ar");
  const q = useQuery({ ...orpc.events.preview.queryOptions({ input: { id, language } }), staleTime: 60_000 });
  return (
    <details className="stack-tight">
      <summary>{t("ev.preview")}</summary>
      <select value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode)} aria-label={t("places.previewLanguage")}>
        {LANGUAGE_CODES.map((c) => <option key={c} value={c} lang={c}>{LANGUAGES[c].nativeName}</option>)}
      </select>
      {q.isPending && <Skeleton lines={1} card={false} />}
      {q.isSuccess && <div className="wa-bubble" lang={language} dir={LANGUAGES[language].dir}>{q.data.text}</div>}
    </details>
  );
}

function DetailSheet({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (e: Event) => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ ...orpc.events.get.queryOptions({ input: { id } }) });
  const remove = useMutation({ ...orpc.events.removeAttendee.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.events.key() }) });
  const e = q.data;
  return (
    <Sheet open onClose={onClose} title={e ? e.title : t("ev.title")} wide>
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {e && (
        <div className="stack">
          <EventFacts e={e} />
          {e.description && <p lang="fr" dir="auto" className="pre-line">{e.description}</p>}
          <section className="stack-tight">
            <h3 className="section-title">{t("ev.whoIsComing")} <span className="muted">({spots(e.going, e.volunteerSpots)})</span></h3>
            {e.attendees.length === 0 && <p className="muted">{t("ev.nobodyYet")}</p>}
            <ul className="attendee-list">
              {e.attendees.map((a) => (
                <li key={a.volunteerId} className="row between">
                  <span>
                    {a.name}
                    {a.status === "waitlist" && <Chip tone="muted">{t("ev.waitingN", { n: a.position ?? 0 })}</Chip>}
                    {a.matches && <Chip tone="ok" icon="sparkles">{t("ev.matches")}</Chip>}
                  </span>
                  {e.canEdit && (
                    <button type="button" className="btn btn-small btn-quiet" disabled={remove.isPending} onClick={() => remove.mutate({ id: e.id, volunteerId: a.volunteerId })}>
                      {t("ev.removeAttendee")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {e.public && (
            <section className="stack-tight">
              <h3 className="section-title">{t("ev.beneficiaries")} <span className="muted">({spots(e.publicGoing, e.publicSpots)})</span></h3>
              {e.publicWaiting > 0 && <p className="muted small">{t("ev.publicWaiting", { n: e.publicWaiting })}</p>}
              {e.canEdit && e.publicLanguages.length > 0 && (
                <div className="chips">
                  {e.publicLanguages.map((l) => (
                    <span key={l.language} className="row tight"><LangBadge language={l.language} /> ×{l.count}</span>
                  ))}
                </div>
              )}
              <p className="muted small">{t("ev.beneficiariesPrivacy")}</p>
              <PreviewBlock id={e.id} />
            </section>
          )}
          <p className="muted small">
            {e.createdByName && t("ev.by", { name: e.createdByName })} · {formatDate(e.date, lang, { weekday: true })}
          </p>
          {e.canEdit && !e.cancelledAt && (
            <button type="button" className="btn btn-block" onClick={() => onEdit(e)}>
              <Icon name="edit" size={18} />
              {t("ev.edit")}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function EventFacts({ e }: { e: Event }) {
  const { t } = useI18n();
  return (
    <>
      <div className="chips">
        <Chip tone="info">{t(`ev.kind.${e.kind}` as MessageKey)}</Chip>
        {e.cancelledAt && <Chip tone="error" icon="x">{t("ev.cancelled")}</Chip>}
        {e.public && <Chip tone="ok" icon="phone">{t("ev.publicChip")}</Chip>}
        {e.association && <Chip tone="muted" icon="building">{e.association.name}</Chip>}
        {e.matchesMe && !e.cancelledAt && <Chip tone="ok" icon="sparkles">{t("ev.matchesMe")}</Chip>}
      </div>
      <dl className="place-facts">
        <div><dt><Icon name="clock" size={16} /><span className="visually-hidden">{t("ev.startTime")}</span></dt><dd dir="ltr">{hours(e)}</dd></div>
        {e.place && <div><dt><Icon name="pin" size={16} /><span className="visually-hidden">{t("ev.place")}</span></dt><dd dir="auto">{e.place}</dd></div>}
        <div>
          <dt><Icon name="users" size={16} /><span className="visually-hidden">{t("ev.whoIsComing")}</span></dt>
          <dd>
            {e.volunteerSpots === null ? t("ev.goingCount", { n: e.going }) : t("ev.goingOf", { n: e.going, max: e.volunteerSpots })}
            {e.waiting > 0 && <span className="muted"> · {t("ev.waitingCount", { n: e.waiting })}</span>}
          </dd>
        </div>
        {(e.languages.length > 0 || e.skills.length > 0) && (
          <div>
            <dt><Icon name="sparkles" size={16} /><span className="visually-hidden">{t("ev.wanted")}</span></dt>
            <dd className="chips">
              {e.languages.map((l) => <LangBadge key={l} language={l} />)}
              {e.skills.map((s) => <span key={s} className="pill">{t(`skill.${s}` as MessageKey)}</span>)}
            </dd>
          </div>
        )}
      </dl>
    </>
  );
}

// --------------------------------------------------------------------------------------- calendar

/** Month grid (Monday first) with a dot on the days that have events; tapping a day filters the list. */
function MonthGrid({ month, setMonth, days, selected, onSelect }: { month: string; setMonth: (m: string) => void; days: Map<string, number>; selected: string | null; onSelect: (d: string | null) => void }) {
  const { t, lang } = useI18n();
  const locale = LANGUAGES[lang].intlLocale;
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayParis();
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => addDays(first, i))];
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const weekday = (i: number) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 2 + i)));
  return (
    <div className="card month">
      <div className="row between">
        <button type="button" className="btn btn-small btn-quiet" aria-label={t("ev.prevMonth")} onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)}>
          <Icon name="chevron" size={18} className="flip" />
        </button>
        <strong className="month-title">{title}</strong>
        <button type="button" className="btn btn-small btn-quiet" aria-label={t("ev.nextMonth")} onClick={() => shift(1)}>
          <Icon name="chevron" size={18} className="icon-dir" />
        </button>
      </div>
      <div className="month-grid" role="grid" aria-label={title}>
        {Array.from({ length: 7 }, (_, i) => <span key={`h${i}`} className="month-head" aria-hidden="true">{weekday(i)}</span>)}
        {cells.map((d, i) =>
          d === null ? <span key={`e${i}`} /> : (
            <button
              key={d}
              type="button"
              className={`month-day${days.has(d) ? " has-events" : ""}${d === today ? " is-today" : ""}${d === selected ? " is-selected" : ""}`}
              disabled={d < today}
              aria-pressed={d === selected}
              aria-label={`${formatDate(d, lang, { weekday: true })}${days.has(d) ? ` · ${t("ev.dayCount", { n: days.get(d)! })}` : ""}`}
              onClick={() => onSelect(d === selected ? null : d)}
            >
              {Number(d.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- screen

export function Events({ openId }: { openId?: string }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [month, setMonth] = useState(() => todayParis().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ edit: Event | null } | null>(null);
  const [cancelling, setCancelling] = useState<Event | null>(null);
  const q = useQuery({ ...orpc.events.list.queryOptions({ input: { scope } }), refetchInterval: 120_000 });
  const invalidate = () => void qc.invalidateQueries({ queryKey: orpc.events.key() });
  const join = useMutation({ ...orpc.events.join.mutationOptions(), onSuccess: (e) => { toast(e.myStatus === "going" ? t("ev.joinedToast") : t("ev.waitlistToast")); invalidate(); } });
  const leave = useMutation({ ...orpc.events.leave.mutationOptions(), onSuccess: () => { toast(t("ev.leftToast")); invalidate(); } });
  const cancel = useMutation({ ...orpc.events.cancel.mutationOptions(), onSuccess: () => { toast(t("ev.cancelledToast")); setCancelling(null); invalidate(); } });
  const error = errorText(join.error ?? leave.error ?? cancel.error, t);

  const all = q.data ?? [];
  const days = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) if (!e.cancelledAt) m.set(e.date, (m.get(e.date) ?? 0) + 1);
    return m;
  }, [all]);
  const shown = day && scope !== "past" ? all.filter((e) => e.date === day) : all;
  const groups = useMemo(() => {
    const g: { date: string; items: Event[] }[] = [];
    for (const e of shown) {
      const last = g.at(-1);
      if (last?.date === e.date) last.items.push(e);
      else g.push({ date: e.date, items: [e] });
    }
    return g;
  }, [shown]);
  const canJoin = can("events.join");

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("ev.title")}</h1>
        {can("events.create") && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setSheet({ edit: null })}>
            <Icon name="plus" size={16} />
            {t("ev.add")}
          </button>
        )}
      </div>
      <p className="muted">{t("ev.intro")}</p>
      <Segmented
        label={t("ev.title")}
        value={scope}
        onChange={(s) => { setScope(s); setDay(null); }}
        options={[{ value: "upcoming", label: t("ev.scope.upcoming") }, { value: "mine", label: t("ev.scope.mine") }, { value: "past", label: t("ev.scope.past") }]}
      />
      {scope === "upcoming" && <MonthGrid month={month} setMonth={setMonth} days={days} selected={day} onSelect={setDay} />}
      {day && (
        <div className="row between">
          <strong>{formatDate(day, lang, { weekday: true })}</strong>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setDay(null)}>{t("ev.showAll")}</button>
        </div>
      )}
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {error && <p className="notice notice-error small">{error}</p>}
      {q.isSuccess && shown.length === 0 && (
        <Empty art="calendar" sub={can("events.create") && scope === "upcoming" ? t("ev.emptySub") : undefined}>
          {day ? t("ev.emptyDay") : t(`ev.empty.${scope}` as MessageKey)}
        </Empty>
      )}
      {groups.map((g) => (
        <section key={g.date} className="stack-tight">
          <h2 className="day-heading">{formatDate(g.date, lang, { weekday: true })}</h2>
          <ul className="cards">
            {g.items.map((e) => {
              const busy = (join.isPending && join.variables?.id === e.id) || (leave.isPending && leave.variables?.id === e.id);
              const open = !e.cancelledAt && scope !== "past";
              const full = e.volunteerSpots !== null && e.going >= e.volunteerSpots;
              return (
                <li key={e.id}>
                  <article className={`card event-card${e.cancelledAt ? " is-cancelled" : ""}${e.myStatus === "going" ? " is-mine" : ""}`}>
                    <div className="row between">
                      <h3 className="card-title">
                        <button type="button" className="link-button" onClick={() => navigate("events", e.id)}>
                          <span aria-hidden="true">{EVENT_EMOJI[e.kind]} </span>
                          <span lang="fr">{e.title}</span>
                        </button>
                      </h3>
                      <OverflowMenu label={t("ev.actions")}>
                        {(close) => (
                          <>
                            <button type="button" role="menuitem" onClick={() => { close(); navigate("events", e.id); }}>
                              <Icon name="users" size={18} />
                              {t("ev.details")}
                            </button>
                            {!e.cancelledAt && (
                              <button type="button" role="menuitem" onClick={() => { close(); downloadIcs(e); }}>
                                <Icon name="calendar" size={18} />
                                {t("appt.calendar")}
                              </button>
                            )}
                            {e.canEdit && open && (
                              <>
                                <button type="button" role="menuitem" onClick={() => { close(); setSheet({ edit: e }); }}>
                                  <Icon name="edit" size={18} />
                                  {t("ev.edit")}
                                </button>
                                <button type="button" role="menuitem" onClick={() => { close(); setCancelling(e); }}>
                                  <Icon name="trash" size={18} />
                                  {t("ev.cancel")}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </OverflowMenu>
                    </div>
                    <EventFacts e={e} />
                    {e.description && <p lang="fr" dir="auto" className="clamp-2">{e.description}</p>}
                    {e.attendees.length > 0 && (
                      <p className="muted small">
                        {e.attendees.filter((a) => a.status === "going").slice(0, 4).map((a) => a.name.split(/\s+/)[0]).join(", ")}
                        {e.going > 4 ? ` +${e.going - 4}` : ""}
                      </p>
                    )}
                    {e.public && <p className="muted small"><Icon name="phone" size={14} /> {t("ev.publicCount", { n: e.publicGoing })}</p>}
                    {open && canJoin && (
                      <div className="row wrap">
                        {e.myStatus === null && (
                          <button type="button" className={`btn btn-small${full ? "" : " btn-primary"}`} disabled={busy} onClick={() => join.mutate({ id: e.id })}>
                            <Icon name={full ? "clock" : "check"} size={16} />
                            {full ? t("ev.joinWaitlist") : t("ev.join")}
                          </button>
                        )}
                        {e.myStatus === "going" && <Chip tone="ok" icon="check">{t("ev.youreIn")}</Chip>}
                        {e.myStatus === "waitlist" && <Chip tone="warn" icon="clock">{t("ev.waitingN", { n: e.myPosition ?? 0 })}</Chip>}
                        {e.myStatus !== null && (
                          <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => leave.mutate({ id: e.id })}>
                            {e.myStatus === "going" ? t("ev.leave") : t("ev.leaveWaitlist")}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {sheet && <EventSheet edit={sheet.edit} date={day ?? addDays(todayParis(), 1)} onClose={() => setSheet(null)} />}
      {openId && !sheet && <DetailSheet id={openId} onClose={() => navigate("events")} onEdit={(e) => setSheet({ edit: e })} />}
      <ConfirmSheet
        open={cancelling !== null}
        title={t("ev.cancelTitle")}
        body={cancelling?.public ? t("ev.cancelBodyPublic", { title: cancelling.title }) : t("ev.cancelBody", { title: cancelling?.title ?? "" })}
        confirmLabel={t("ev.cancel")}
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate({ id: cancelling.id })}
        onClose={() => setCancelling(null)}
      />
    </section>
  );
}
