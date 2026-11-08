import type { LanguageCode, Place, PlaceInput, PlaceKind } from "@wilson/contracts";
import { LANGUAGES, LANGUAGE_CODES, PLACE_KINDS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "../components/badges";
import { DateField } from "../components/DateField";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { todayParis } from "../lib/format";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

export const PLACE_EMOJI: Record<PlaceKind, string> = { shelter: "🛏️", food: "🍽️", shower: "🚿", clothes: "👕", health: "🩺", other: "📌" };
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Short weekday name in the UI language (2026-11-02 is a Monday). */
function weekdayName(d: number, lang: LanguageCode): string {
  return new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + d)));
}

type Draft = { kind: PlaceKind; name: string; address: string; phone: string; details: string; startsOn: string; endsOn: string; weekdays: number[]; opensAt: string; closesAt: string };
const empty = (): Draft => ({ kind: "shelter", name: "", address: "", phone: "", details: "", startsOn: todayParis(), endsOn: todayParis(), weekdays: [], opensAt: "", closesAt: "" });
const fromPlace = (p: Place): Draft => ({
  kind: p.kind, name: p.name, address: p.address ?? "", phone: p.phone ?? "", details: p.details ?? "", startsOn: p.startsOn, endsOn: p.endsOn ?? "",
  weekdays: p.weekdays, opensAt: p.opensAt ?? "", closesAt: p.closesAt ?? "",
});
const toInput = (d: Draft): PlaceInput => ({
  kind: d.kind, name: d.name.trim(), address: d.address.trim() || null, phone: d.phone.trim() || null, details: d.details.trim() || null,
  startsOn: d.startsOn, endsOn: d.endsOn || null, weekdays: d.weekdays, opensAt: d.opensAt || null, closesAt: d.closesAt || null,
});

function PlaceSheet({ edit, onClose }: { edit: Place | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(edit ? fromPlace(edit) : empty());
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const done = () => {
    toast(t("places.savedToast"));
    void qc.invalidateQueries({ queryKey: orpc.places.key() });
    onClose();
  };
  const create = useMutation({ ...orpc.places.create.mutationOptions(), onSuccess: done });
  const update = useMutation({ ...orpc.places.update.mutationOptions(), onSuccess: done });
  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(d.startsOn) && (!d.endsOn || d.endsOn >= d.startsOn);
  const valid = d.name.trim().length >= 2 && datesOk;
  const error = create.error ?? update.error;
  return (
    <Sheet open onClose={onClose} title={edit ? t("places.edit") : t("places.add")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (edit) update.mutate({ id: edit.id, place: toInput(d) });
          else create.mutate(toInput(d));
        }}
      >
        <p className="sheet-text">{t("places.formHelp")}</p>
        <div className="field">
          <span className="field-label">{t("places.kind")}</span>
          <div className="kind-picker" role="radiogroup" aria-label={t("places.kind")}>
            {PLACE_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} className={`kind-option${d.kind === k ? " is-active" : ""}`} onClick={() => set("kind", k)}>
                <span aria-hidden="true">{PLACE_EMOJI[k]}</span>
                {t(`places.kind.${k}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">{t("places.name")}</span>
          <input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={t("places.namePlaceholder")} maxLength={120} lang="fr" dir="auto" required />
        </label>
        <label className="field">
          <span className="field-label">{t("places.address")} <span className="muted small">{t("common.optional")}</span></span>
          <input value={d.address} onChange={(e) => set("address", e.target.value)} maxLength={200} autoComplete="off" dir="auto" />
        </label>
        <div className="row wrap form-pair">
          <label className="field">
            <span className="field-label">{t("places.opensAt")}</span>
            <input type="time" value={d.opensAt} onChange={(e) => set("opensAt", e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t("places.closesAt")}</span>
            <input type="time" value={d.closesAt} onChange={(e) => set("closesAt", e.target.value)} dir="ltr" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("places.phone")} <span className="muted small">{t("common.optional")}</span></span>
          <input type="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} dir="ltr" />
        </label>
        <label className="field">
          <span className="field-label">{t("places.details")} <span className="muted small">{t("common.optional")}</span></span>
          <textarea value={d.details} onChange={(e) => set("details", e.target.value)} placeholder={t("places.detailsPlaceholder")} maxLength={500} rows={3} lang="fr" dir="auto" />
        </label>
        <DateField label={t("places.startsOn")} value={d.startsOn} onChange={(v) => set("startsOn", v)} previewKey="places.datePreview" />
        <DateField label={t("places.endsOn")} value={d.endsOn} onChange={(v) => set("endsOn", v)} previewKey="places.datePreview" />
        <button type="button" className="btn btn-small btn-quiet align-start" onClick={() => set("endsOn", "")} disabled={!d.endsOn}>
          {t("places.noEnd")}
        </button>
        {d.endsOn && d.endsOn < d.startsOn && <p className="notice notice-error"><Icon name="alert" size={20} /><span className="notice-body">{t("places.endBeforeStart")}</span></p>}
        <div className="field">
          <span className="field-label">{t("places.weekdays")}</span>
          <div className="weekday-picker">
            {WEEKDAYS.map((w) => {
              const on = d.weekdays.includes(w);
              return (
                <button key={w} type="button" aria-pressed={on} className={`weekday${on ? " is-active" : ""}`} onClick={() => set("weekdays", on ? d.weekdays.filter((x) => x !== w) : [...d.weekdays, w].sort())}>
                  {weekdayName(w, lang)}
                </button>
              );
            })}
          </div>
          <span className="muted small">{t("places.weekdaysHelp")}</span>
        </div>
        {error && <ErrorBox error={error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || create.isPending || update.isPending}>
            {edit ? t("vol.save") : t("places.publish")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** The exact WhatsApp message a person gets for "5" today, in a chosen language. */
function PreviewSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [language, setLanguage] = useState<LanguageCode>("ar");
  const q = useQuery({ ...orpc.places.preview.queryOptions({ input: { language } }), staleTime: 30_000 });
  return (
    <Sheet open onClose={onClose} title={t("places.preview")}>
      <div className="stack">
        <label className="field">
          <span className="field-label">{t("places.previewLanguage")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode)}>
            {LANGUAGE_CODES.map((c) => (
              <option key={c} value={c} lang={c}>
                {LANGUAGES[c].nativeName}
              </option>
            ))}
          </select>
        </label>
        {q.isPending && <Skeleton lines={1} />}
        {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
        {q.isSuccess && (q.data.text ? <div className="wa-bubble" lang={language} dir={LANGUAGES[language].dir}>{q.data.text}</div> : <Empty art="calendar">{t("places.emptyToday")}</Empty>)}
        <p className="muted small">{t("places.previewHelp")}</p>
      </div>
    </Sheet>
  );
}

function when(p: Place, t: ReturnType<typeof useI18n>["t"], lang: LanguageCode): string {
  const days = p.weekdays.length ? p.weekdays.map((w) => weekdayName(w, lang)).join(", ") : t("places.everyDay");
  const range = p.endsOn === p.startsOn ? formatDate(p.startsOn, lang)
    : p.endsOn ? t("places.fromTo", { from: formatDate(p.startsOn, lang), to: formatDate(p.endsOn, lang) })
    : t("places.fromNoEnd", { from: formatDate(p.startsOn, lang) });
  return p.endsOn === p.startsOn ? range : `${range} · ${days}`;
}

export function Places() {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<"today" | "upcoming">("today");
  const q = useQuery({ ...orpc.places.list.queryOptions({ input: { scope } }), refetchInterval: 120_000 });
  const [sheet, setSheet] = useState<{ edit: Place | null } | null>(null);
  const [removing, setRemoving] = useState<Place | null>(null);
  const [preview, setPreview] = useState(false);
  const remove = useMutation({
    ...orpc.places.remove.mutationOptions(),
    onSuccess: () => {
      toast(t("places.removedToast"));
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: orpc.places.key() });
    },
  });
  const manage = can("places.manage");

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("places.title")}</h1>
        {manage && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setSheet({ edit: null })}>
            <Icon name="plus" size={16} />
            {t("places.add")}
          </button>
        )}
      </div>
      <p className="muted">{t("places.intro")}</p>
      <div className="row between wrap">
        <Segmented label={t("places.filter")} value={scope} onChange={setScope} options={[{ value: "today", label: t("places.filter.today") }, { value: "upcoming", label: t("places.filter.upcoming") }]} />
        <button type="button" className="btn btn-small" onClick={() => setPreview(true)}>
          <Icon name="phone" size={16} />
          {t("places.preview")}
        </button>
      </div>
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {remove.error && <ErrorBox error={remove.error} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="calendar" sub={manage ? t("places.emptySub") : undefined}>{scope === "today" ? t("places.emptyToday") : t("places.empty")}</Empty>}
      <ul className="cards">
        {q.data?.map((p) => (
          <li key={p.id}>
            <article className="card place-card">
              <div className="row between">
                <h2 className="card-title" lang="fr">
                  <span aria-hidden="true">{PLACE_EMOJI[p.kind]} </span>
                  {p.name}
                </h2>
                {manage && (
                  <OverflowMenu label={t("places.actions")}>
                    {(close) => (
                      <>
                        <button type="button" role="menuitem" onClick={() => { close(); setSheet({ edit: p }); }}>
                          <Icon name="edit" size={18} />
                          {t("places.edit")}
                        </button>
                        <button type="button" role="menuitem" onClick={() => { close(); setRemoving(p); }}>
                          <Icon name="trash" size={18} />
                          {t("places.remove")}
                        </button>
                      </>
                    )}
                  </OverflowMenu>
                )}
              </div>
              <div className="chips">
                <Chip tone="info">{t(`places.kind.${p.kind}` as MessageKey)}</Chip>
                {p.openToday ? <Chip tone="ok" icon="check">{t("places.openToday")}</Chip> : <Chip tone="muted">{t("places.notToday")}</Chip>}
                {p.address && (p.located
                  ? <Chip tone="muted" icon="pin">{t("places.located")}</Chip>
                  : <Chip tone="warn" icon="alert">{t("places.notLocated")}</Chip>)}
              </div>
              {p.address && !p.located && <p className="muted">{t("places.notLocatedHelp")}</p>}
              <dl className="place-facts">
                {(p.opensAt || p.closesAt) && (
                  <div><dt><Icon name="clock" size={16} /><span className="visually-hidden">{t("places.hours")}</span></dt><dd dir="ltr">{[p.opensAt, p.closesAt].filter(Boolean).join("–")}</dd></div>
                )}
                {p.address && <div><dt><Icon name="building" size={16} /><span className="visually-hidden">{t("places.address")}</span></dt><dd dir="auto">{p.address}</dd></div>}
                {p.phone && <div><dt><Icon name="phone" size={16} /><span className="visually-hidden">{t("places.phone")}</span></dt><dd dir="ltr"><a href={`tel:${p.phone.replace(/\s/g, "")}`}>{p.phone}</a></dd></div>}
                <div><dt><Icon name="calendar" size={16} /><span className="visually-hidden">{t("places.dates")}</span></dt><dd>{when(p, t, lang)}</dd></div>
              </dl>
              {p.details && <p lang="fr" dir="auto">{p.details}</p>}
              {p.updatedByName && <p className="muted small">{t("places.updatedBy", { name: p.updatedByName })}</p>}
            </article>
          </li>
        ))}
      </ul>
      {sheet && <PlaceSheet edit={sheet.edit} onClose={() => setSheet(null)} />}
      {preview && <PreviewSheet onClose={() => setPreview(false)} />}
      <ConfirmSheet
        open={removing !== null}
        title={t("places.removeTitle")}
        body={t("places.removeBody", { name: removing?.name ?? "" })}
        confirmLabel={t("places.remove")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
