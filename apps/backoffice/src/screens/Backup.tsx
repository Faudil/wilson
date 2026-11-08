import type { BackupCall, BackupInput, LanguageCode, VolunteerSkill } from "@wilson/contracts";
import { LANGUAGE_CODES, LANGUAGES, VOLUNTEER_SKILLS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";
import { relativeTime } from "../lib/relative";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { SkillChips } from "./CaseFile";
import { Segmented } from "./Queue";

const OTHER_LANGUAGES = LANGUAGE_CODES.filter((c) => c !== "fr");
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

type Draft = { title: string; details: string; neededOn: string; startsAt: string; place: string; languages: LanguageCode[]; skills: VolunteerSkill[]; needed: number; openToAll: boolean };

function AskSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { volunteer } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>({ title: "", details: "", neededOn: addDays(todayParis(), 1), startsAt: "", place: "", languages: [], skills: [], needed: 1, openToAll: !volunteer.association });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const create = useMutation({
    ...orpc.backup.create.mutationOptions(),
    onSuccess: () => {
      toast(t("backup.postedToast"));
      void qc.invalidateQueries({ queryKey: orpc.backup.key() });
      onClose();
    },
  });
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(d.neededOn) && d.neededOn >= todayParis();
  const valid = d.title.trim().length >= 3 && dateOk;
  const input = (): BackupInput => ({
    title: d.title.trim(), details: d.details.trim() || null, neededOn: d.neededOn, startsAt: d.startsAt || null, place: d.place.trim() || null,
    languages: d.languages, skills: d.skills, needed: d.needed, openToAll: d.openToAll,
  });
  return (
    <Sheet open onClose={onClose} title={t("backup.ask")}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(input()); }}>
        <p className="sheet-text">{t("backup.askHelp")}</p>
        <label className="field">
          <span className="field-label">{t("backup.what")}</span>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder={t("backup.whatPlaceholder")} dir="auto" required />
        </label>
        <DateField label={t("backup.when")} value={d.neededOn} onChange={(v) => set("neededOn", v)} previewKey="backup.datePreview" />
        {!dateOk && d.neededOn && <p className="notice notice-error"><Icon name="alert" size={20} /><span className="notice-body">{t("backup.pastDate")}</span></p>}
        <div className="row wrap form-pair">
          <label className="field">
            <span className="field-label">{t("backup.time")} <span className="muted small">{t("common.optional")}</span></span>
            <input type="time" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t("backup.needed")}</span>
            <input type="number" min={1} max={20} value={d.needed} onChange={(e) => set("needed", Math.min(20, Math.max(1, Number(e.target.value) || 1)))} dir="ltr" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("backup.place")} <span className="muted small">{t("common.optional")}</span></span>
          <input value={d.place} onChange={(e) => set("place", e.target.value)} maxLength={200} placeholder={t("backup.placePlaceholder")} dir="auto" />
        </label>
        <fieldset className="stack-tight">
          <legend className="field-label">{t("backup.languages")} <span className="muted small">{t("common.optional")}</span></legend>
          <div className="toggle-chips">
            {OTHER_LANGUAGES.map((code) => (
              <button key={code} type="button" aria-pressed={d.languages.includes(code)} className="toggle-chip" lang={code} dir={LANGUAGES[code].dir} onClick={() => set("languages", toggle(d.languages, code))}>
                {LANGUAGES[code].nativeName}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="stack-tight">
          <legend className="field-label">{t("backup.skills")} <span className="muted small">{t("common.optional")}</span></legend>
          <div className="toggle-chips">
            {VOLUNTEER_SKILLS.map((s) => (
              <button key={s} type="button" aria-pressed={d.skills.includes(s)} className="toggle-chip" onClick={() => set("skills", toggle(d.skills, s))}>
                {t(`skill.${s}` as MessageKey)}
              </button>
            ))}
          </div>
          <small className="muted">{t("backup.matchHelp")}</small>
        </fieldset>
        <label className="field">
          <span className="field-label">{t("backup.details")} <span className="muted small">{t("common.optional")}</span></span>
          <textarea value={d.details} onChange={(e) => set("details", e.target.value)} maxLength={1000} rows={3} placeholder={t("backup.detailsPlaceholder")} dir="auto" />
          <small className="muted">{t("backup.privacy")}</small>
        </label>
        {volunteer.association && (
          <label className="check">
            <input type="checkbox" checked={d.openToAll} onChange={(e) => set("openToAll", e.target.checked)} />
            <span>
              {t("backup.openToAll")}
              <small className="muted block">{t("backup.openToAllHelp", { name: volunteer.association.name })}</small>
            </span>
          </label>
        )}
        {create.error && <ErrorBox error={create.error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || create.isPending}>
            <Icon name="send" size={18} />
            {t("backup.post")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Sheet>
  );
}

function OfferSheet({ call, onClose }: { call: BackupCall; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const offer = useMutation({
    ...orpc.backup.offer.mutationOptions(),
    onSuccess: () => {
      toast(t("backup.offeredToast"));
      void qc.invalidateQueries({ queryKey: orpc.backup.key() });
      onClose();
    },
  });
  return (
    <Sheet open onClose={onClose} title={t("backup.offer")}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); offer.mutate({ id: call.id, note: note.trim() || undefined }); }}>
        <p className="sheet-text">{t("backup.offerHelp", { name: call.authorName ?? "" })}</p>
        <label className="field">
          <span className="field-label">{t("backup.offerNote")} <span className="muted small">{t("common.optional")}</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("backup.offerNotePlaceholder")} dir="auto" />
        </label>
        {offer.error && <ErrorBox error={offer.error} />}
        <button type="submit" className="btn btn-block btn-primary" disabled={offer.isPending}>
          <Icon name="hand" size={18} />
          {t("backup.offerConfirm")}
        </button>
      </form>
    </Sheet>
  );
}

function CallCard({ call, onOffer, onClose }: { call: BackupCall; onOffer: () => void; onClose: (status: "covered" | "cancelled") => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const withdraw = useMutation({ ...orpc.backup.withdraw.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.backup.key() }) });
  const open = call.status === "open" && call.neededOn >= todayParis();
  const covered = call.offerCount >= call.needed;
  return (
    <article className={`card backup-card${call.forMe && open ? " is-for-me" : ""}`}>
      <div className="chips">
        {call.forMe && open && <Chip tone="ok" icon="sparkles">{t("backup.forMe")}</Chip>}
        {call.status === "covered" && <Chip tone="ok" icon="check">{t("backup.status.covered")}</Chip>}
        {call.status === "cancelled" && <Chip tone="muted">{t("backup.status.cancelled")}</Chip>}
        {call.status === "open" && !open && <Chip tone="muted">{t("backup.status.over")}</Chip>}
        {call.openToAll && <Chip tone="info" icon="globe">{t("backup.allAssociations")}</Chip>}
        {call.association && (call.openToAll || !call.mine) && <Chip tone="muted" icon="building">{call.association.name}</Chip>}
      </div>
      <h2 className="card-title" dir="auto">{call.title}</h2>
      <dl className="place-facts">
        <div><dt><Icon name="calendar" size={16} /><span className="visually-hidden">{t("backup.when")}</span></dt><dd><bdi>{formatDate(call.neededOn, lang, { weekday: true })}</bdi>{call.startsAt && <> · <bdi dir="ltr">{call.startsAt}</bdi></>}</dd></div>
        {call.place && <div><dt><Icon name="pin" size={16} /><span className="visually-hidden">{t("backup.place")}</span></dt><dd dir="auto">{call.place}</dd></div>}
        <div><dt><Icon name="users" size={16} /><span className="visually-hidden">{t("backup.needed")}</span></dt><dd>{t("backup.offersOf", { n: call.offerCount, needed: call.needed })}</dd></div>
      </dl>
      {(call.languages.length > 0 || call.skills.length > 0) && (
        <div className="chips">
          {call.languages.map((l) => <LangBadge key={l} language={l} />)}
          <SkillChips skills={call.skills} />
        </div>
      )}
      {call.details && <p dir="auto">{call.details}</p>}
      <p className="muted small">{call.mine ? t("backup.askedByYou", { when: relativeTime(call.createdAt, lang) }) : t("backup.askedBy", { name: call.authorName ?? "?", when: relativeTime(call.createdAt, lang) })}</p>

      {call.offers && call.offers.length > 0 && (
        <div className="backup-offers">
          <strong className="small">{t("backup.whoOffered")}</strong>
          <ul>
            {call.offers.map((o) => (
              <li key={o.volunteerId}>
                <Icon name="hand" size={16} />
                <span><strong>{o.name}</strong>{o.note && <span dir="auto"> · {o.note}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {call.offers && call.offers.length === 0 && open && <p className="muted small">{t("backup.noOffersYet")}</p>}

      {open && (
        <div className="row wrap">
          {!call.mine && !call.offered && (
            <button type="button" className="btn btn-small btn-primary" onClick={onOffer}>
              <Icon name="hand" size={16} />
              {t("backup.offer")}
            </button>
          )}
          {call.offered && (
            <>
              <Chip tone="ok" icon="check">{t("backup.youOffered")}</Chip>
              <button type="button" className="btn btn-small btn-quiet" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ id: call.id })}>
                <Icon name="undo" size={16} />
                {t("backup.withdraw")}
              </button>
            </>
          )}
          {call.canClose && (
            <>
              <button type="button" className={`btn btn-small${covered ? " btn-primary" : ""}`} onClick={() => onClose("covered")}>
                <Icon name="check" size={16} />
                {t("backup.markCovered")}
              </button>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => onClose("cancelled")}>
                {t("backup.cancel")}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** Renforts: volunteers asking each other for a hand ("need an Arabic speaker tomorrow at the prefecture"). */
export function Backup() {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<"open" | "mine" | "past">("open");
  const q = useQuery({ ...orpc.backup.list.queryOptions({ input: { scope } }), refetchInterval: 120_000 });
  const [asking, setAsking] = useState(false);
  const [offering, setOffering] = useState<BackupCall | null>(null);
  const [closing, setClosing] = useState<{ call: BackupCall; status: "covered" | "cancelled" } | null>(null);
  const close = useMutation({
    ...orpc.backup.close.mutationOptions(),
    onSuccess: (c) => {
      toast(c.status === "covered" ? t("backup.coveredToast") : t("backup.cancelledToast"));
      setClosing(null);
      void qc.invalidateQueries({ queryKey: orpc.backup.key() });
    },
  });
  const forMe = q.data?.filter((c) => c.forMe && !c.offered).length ?? 0;
  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("backup.title")}</h1>
        {can("backup.ask") && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setAsking(true)}>
            <Icon name="plus" size={16} />
            {t("backup.ask")}
          </button>
        )}
      </div>
      <p className="muted">{t("backup.intro")}</p>
      <Segmented
        label={t("backup.filter")}
        value={scope}
        onChange={setScope}
        options={[
          { value: "open", label: t("backup.filter.open"), count: scope === "open" && forMe ? forMe : undefined },
          { value: "mine", label: t("backup.filter.mine") },
          { value: "past", label: t("backup.filter.past") },
        ]}
      />
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {close.error && <ErrorBox error={close.error} />}
      {q.isSuccess && q.data.length === 0 && (
        <Empty art="people" sub={scope === "open" && can("backup.ask") ? t("backup.emptySub") : undefined}>
          {scope === "open" ? t("backup.empty") : scope === "mine" ? t("backup.emptyMine") : t("backup.emptyPast")}
        </Empty>
      )}
      <ul className="cards">
        {q.data?.map((c) => (
          <li key={c.id}>
            <CallCard call={c} onOffer={() => setOffering(c)} onClose={(status) => setClosing({ call: c, status })} />
          </li>
        ))}
      </ul>
      {asking && <AskSheet onClose={() => setAsking(false)} />}
      {offering && <OfferSheet call={offering} onClose={() => setOffering(null)} />}
      <ConfirmSheet
        open={closing !== null}
        title={closing?.status === "covered" ? t("backup.coveredTitle") : t("backup.cancelTitle")}
        body={closing?.status === "covered" ? t("backup.coveredBody") : t("backup.cancelBody")}
        confirmLabel={closing?.status === "covered" ? t("backup.markCovered") : t("backup.cancel")}
        tone={closing?.status === "covered" ? undefined : "danger"}
        busy={close.isPending}
        onConfirm={() => closing && close.mutate({ id: closing.call.id, status: closing.status })}
        onClose={() => { close.reset(); setClosing(null); }}
      />
    </section>
  );
}
