import type {
  BuddyCandidate, BuddyMatch, BuddyMatchDetail, BuddyMatchStatus, BuddyMode, BuddyProfile, BuddyReport, BuddyRequest, BuddySlot, BuddyWindow,
  LanguageCode,
} from "@wilson/contracts";
import { LANGUAGES, LANGUAGE_CODES } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { Icon } from "../components/Icon";
import { BackLink, ConfirmSheet, Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey, type TFn } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { relativeTime } from "../lib/relative";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDateTime } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

// Plain copies of two contract helpers: the back-office must not import the zod schemas (bundle test).
const WINDOWS: BuddyWindow[] = ["weekday_morning", "weekday_afternoon", "weekday_evening", "weekend"];
const windowOf = (s: BuddySlot): BuddyWindow =>
  s.weekday >= 6 ? "weekend" : Number(s.time.slice(0, 2)) < 12 ? "weekday_morning" : Number(s.time.slice(0, 2)) < 17 ? "weekday_afternoon" : "weekday_evening";

type Tab = "mine" | "requests" | "all" | "reports";

function weekdayName(weekday: number, lang: LanguageCode): string {
  // 1 Jan 2024 was a Monday: day N of that month is ISO weekday N.
  return new Intl.DateTimeFormat(LANGUAGES[lang].intlLocale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}
const slotLabel = (s: { weekday: number; time: string }, lang: LanguageCode) => `${weekdayName(s.weekday, lang)} ${s.time}`;

const STATUS_TONE: Record<BuddyMatchStatus, "ok" | "warn" | "urgent" | "info" | "muted" | "error"> = {
  proposed: "info", active: "ok", suspended: "urgent", ended: "muted", declined: "muted",
};

function StatusChip({ status }: { status: BuddyMatchStatus }) {
  const { t } = useI18n();
  return <Chip tone={STATUS_TONE[status]}>{t(`buddy.status.${status}` as MessageKey)}</Chip>;
}

function reasonText(t: TFn, error: unknown): string | null {
  const reason = (error as { data?: { reason?: string } } | null)?.data?.reason;
  if (errorCode(error) === "CONFLICT" && reason) return t(`buddy.conflict.${reason}` as MessageKey);
  return null;
}

// ---------------------------------------------------------------- profile

function ProfileSheet({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: BuddyProfile | null }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState<BuddyProfile>(profile ?? { active: true, languages: [], slots: [], modes: ["meet"], maxBuddies: 1, meetPlace: null });
  const [slot, setSlot] = useState<BuddySlot>({ weekday: 2, time: "18:30" });
  useEffect(() => {
    if (open && profile) setP(profile);
  }, [open, profile]);
  const save = useMutation({
    ...orpc.buddies.saveProfile.mutationOptions(),
    onSuccess: () => {
      toast(t("buddy.profile.saved"));
      void qc.invalidateQueries({ queryKey: orpc.buddies.key() });
      onClose();
    },
  });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const invalid = p.modes.length === 0 || (p.modes.includes("meet") && !p.meetPlace?.trim());

  return (
    <Sheet open={open} onClose={onClose} title={t("buddy.profile.title")} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(p); }}>
        <p className="sheet-text">{t("buddy.profile.intro")}</p>
        <label className="check">
          <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} />
          <span>{t("buddy.profile.active")}</span>
        </label>
        <fieldset className="stack-tight">
          <legend className="field-label">{t("buddy.profile.modes")}</legend>
          {(["meet", "call"] as BuddyMode[]).map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={p.modes.includes(m)} onChange={() => setP({ ...p, modes: toggle(p.modes, m) })} />
              <span>{t(`buddy.mode.${m}` as MessageKey)}</span>
            </label>
          ))}
        </fieldset>
        {p.modes.includes("meet") && (
          <label className="field">
            <span className="field-label">{t("buddy.profile.place")}</span>
            <input value={p.meetPlace ?? ""} maxLength={120} dir="auto" placeholder={t("buddy.profile.placeHint")} onChange={(e) => setP({ ...p, meetPlace: e.target.value })} />
            <span className="muted small">{t("buddy.profile.placeNote")}</span>
          </label>
        )}
        <fieldset className="stack-tight">
          <legend className="field-label">{t("buddy.profile.slots")}</legend>
          {p.slots.length === 0 && <span className="muted small">{t("buddy.profile.noSlot")}</span>}
          <div className="chips">
            {p.slots.map((s, i) => (
              <button key={`${s.weekday}-${s.time}`} type="button" className="chip chip-info" aria-label={t("buddy.profile.removeSlot", { slot: slotLabel(s, lang) })} onClick={() => setP({ ...p, slots: p.slots.filter((_, j) => j !== i) })}>
                {slotLabel(s, lang)} <Icon name="x" size={14} />
              </button>
            ))}
          </div>
          <div className="row wrap">
            <select aria-label={t("buddy.weekday")} value={slot.weekday} onChange={(e) => setSlot({ ...slot, weekday: Number(e.target.value) })} style={{ inlineSize: "auto" }}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{weekdayName(d, lang)}</option>)}
            </select>
            <input type="time" aria-label={t("buddy.time")} value={slot.time} step={900} dir="ltr" onChange={(e) => setSlot({ ...slot, time: e.target.value })} style={{ inlineSize: "auto" }} />
            <button type="button" className="btn btn-small" disabled={!/^\d{2}:\d{2}$/.test(slot.time) || p.slots.some((s) => s.weekday === slot.weekday && s.time === slot.time)} onClick={() => setP({ ...p, slots: [...p.slots, slot] })}>
              <Icon name="plus" size={16} />
              {t("buddy.profile.addSlot")}
            </button>
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">{t("buddy.profile.languages")}</span>
          <select multiple size={6} value={p.languages} onChange={(e) => setP({ ...p, languages: [...e.target.selectedOptions].map((o) => o.value as LanguageCode) })}>
            {LANGUAGE_CODES.filter((c) => c !== "fr").map((c) => (
              <option key={c} value={c} lang={c} dir={LANGUAGES[c].dir}>{LANGUAGES[c].nativeName}</option>
            ))}
          </select>
          <span className="muted small">{t("buddy.profile.languagesHint")}</span>
        </label>
        <label className="field">
          <span className="field-label">{t("buddy.profile.max")}</span>
          <select value={p.maxBuddies} onChange={(e) => setP({ ...p, maxBuddies: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {save.error && <ErrorBox error={save.error} />}
        <button type="submit" className="btn btn-block btn-primary" disabled={invalid || save.isPending}>
          {t("buddy.profile.save")}
        </button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- propose

function ProposeSheet({ request, candidate, profile, onClose }: { request: BuddyRequest; candidate: BuddyCandidate | null; profile: BuddyProfile | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const slots = candidate?.matchingSlots.length ? candidate.matchingSlots : (profile?.slots ?? []).filter((s) => request.windows.includes(windowOf(s)));
  const modes = candidate?.modes ?? profile?.modes ?? ["meet"];
  const prefMode: BuddyMode = request.mode !== "either" && modes.includes(request.mode) ? request.mode : (modes[0] ?? "meet");
  const [slot, setSlot] = useState<BuddySlot>(slots[0] ?? { weekday: 2, time: "18:30" });
  const [mode, setMode] = useState<BuddyMode>(prefMode);
  const [place, setPlace] = useState(profile?.meetPlace ?? "");
  const propose = useMutation({
    ...orpc.buddies.propose.mutationOptions(),
    onSuccess: () => {
      toast(t("buddy.propose.sent"));
      void qc.invalidateQueries({ queryKey: orpc.buddies.key() });
      onClose();
    },
  });
  return (
    <Sheet open onClose={onClose} title={candidate ? t("buddy.propose.titleFor", { name: candidate.name }) : t("buddy.propose.title")}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        propose.mutate({ requestId: request.id, volunteerId: candidate?.volunteerId, weekday: slot.weekday, time: slot.time, mode, place: mode === "meet" ? place.trim() || null : null });
      }}>
        <p className="sheet-text">{t("buddy.propose.intro")}</p>
        <div className="row wrap">
          <select aria-label={t("buddy.weekday")} value={slot.weekday} onChange={(e) => setSlot({ ...slot, weekday: Number(e.target.value) })} style={{ inlineSize: "auto" }}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{weekdayName(d, lang)}</option>)}
          </select>
          <input type="time" aria-label={t("buddy.time")} value={slot.time} step={900} dir="ltr" onChange={(e) => setSlot({ ...slot, time: e.target.value })} style={{ inlineSize: "auto" }} />
        </div>
        {slots.length > 0 && (
          <div className="chips">
            {slots.map((s) => (
              <button key={`${s.weekday}-${s.time}`} type="button" className={`chip ${s.weekday === slot.weekday && s.time === slot.time ? "chip-ok" : "chip-muted"}`} onClick={() => setSlot(s)}>
                {slotLabel(s, lang)}
              </button>
            ))}
          </div>
        )}
        <Segmented label={t("buddy.profile.modes")} value={mode} onChange={setMode} options={modes.map((m) => ({ value: m, label: t(`buddy.mode.${m}` as MessageKey) }))} />
        {mode === "meet" && !candidate && (
          <label className="field">
            <span className="field-label">{t("buddy.profile.place")}</span>
            <input value={place} maxLength={120} dir="auto" onChange={(e) => setPlace(e.target.value)} />
          </label>
        )}
        {propose.error && (reasonText(t, propose.error) ? <p className="callout callout-small">{reasonText(t, propose.error)}</p> : <ErrorBox error={propose.error} />)}
        <button type="submit" className="btn btn-block btn-primary" disabled={propose.isPending || !/^\d{2}:\d{2}$/.test(slot.time)}>
          <Icon name="send" size={18} />
          {t("buddy.propose.send")}
        </button>
      </form>
    </Sheet>
  );
}

function CandidatesSheet({ request, onClose, onPick }: { request: BuddyRequest; onClose: () => void; onPick: (c: BuddyCandidate) => void }) {
  const { t, lang } = useI18n();
  const q = useQuery(orpc.buddies.candidates.queryOptions({ input: { requestId: request.id } }));
  return (
    <Sheet open onClose={onClose} title={t("buddy.candidates.title")}>
      <div className="stack">
        {q.isPending && <Skeleton lines={2} />}
        {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
        {q.isSuccess && q.data.length === 0 && <Empty art="people">{t("buddy.candidates.none")}</Empty>}
        <ul className="cards">
          {q.data?.map((c) => (
            <li key={c.volunteerId}>
              <button type="button" className="card card-button" onClick={() => onPick(c)} style={{ inlineSize: "100%", textAlign: "start" }}>
                <strong className="card-title">{c.name}</strong>
                <div className="chips">
                  {c.sharedLanguage && <Chip tone="ok" icon="globe">{t("buddy.candidates.speaks", { language: LANGUAGES[request.language].nativeName })}</Chip>}
                  {c.matchingSlots.map((s) => <Chip key={`${s.weekday}${s.time}`} tone="info" icon="clock">{slotLabel(s, lang)}</Chip>)}
                  <Chip tone="muted">{t("buddy.candidates.spots", { n: c.freeSpots })}</Chip>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- lists

function MatchCard({ m, showVolunteer }: { m: BuddyMatch; showVolunteer?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <li>
      <a className={`card${m.status === "suspended" ? " is-attention" : ""}`} href={href("buddies", m.id)}>
        <div className="card-top">
          <strong className="card-title" dir="ltr">{m.beneficiaryLabel}</strong>
          <LangBadge language={m.beneficiaryLanguage} />
        </div>
        <div className="chips">
          <StatusChip status={m.status} />
          <Chip tone="muted" icon={m.mode === "call" ? "phone" : "building"}>{t(`buddy.mode.${m.mode}` as MessageKey)}</Chip>
          <Chip tone="muted" icon="clock">{slotLabel(m, lang)}</Chip>
          {m.openReports > 0 && <Chip tone="urgent" icon="alert">{t("buddy.reported")}</Chip>}
        </div>
        {showVolunteer && <p className="muted small">{t("buddy.with", { name: m.volunteer.name })}</p>}
        {m.nextSession && <p className="muted small">{t("buddy.next", { date: formatDateTime(m.nextSession.startsAt, lang) })}</p>}
      </a>
    </li>
  );
}

function Mine() {
  const { t } = useI18n();
  const profile = useQuery(orpc.buddies.myProfile.queryOptions());
  const mine = useQuery({ ...orpc.buddies.mine.queryOptions(), refetchInterval: 60_000 });
  const [edit, setEdit] = useState(false);
  return (
    <div className="stack">
      {profile.isSuccess && (
        <div className={`callout ${profile.data?.active ? "callout-ok" : "callout-info"}`}>
          <Icon name={profile.data?.active ? "check" : "info"} size={20} />
          <div className="stack-tight">
            <span>{!profile.data ? t("buddy.profile.none") : profile.data.active ? t("buddy.profile.on") : t("buddy.profile.off")}</span>
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => setEdit(true)}>
                <Icon name="edit" size={16} />
                {profile.data ? t("buddy.profile.edit") : t("buddy.profile.create")}
              </button>
            </div>
          </div>
        </div>
      )}
      {mine.isPending && <Skeleton lines={2} />}
      {mine.isError && <ErrorBox error={mine.error} retry={() => void mine.refetch()} />}
      {mine.isSuccess && mine.data.length === 0 && <Empty art="people" sub={t("buddy.mine.emptySub")}>{t("buddy.mine.empty")}</Empty>}
      <ul className="cards">{mine.data?.map((m) => <MatchCard key={m.id} m={m} />)}</ul>
      <ProfileSheet open={edit} onClose={() => setEdit(false)} profile={profile.data ?? null} />
    </div>
  );
}

function Requests() {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const q = useQuery({ ...orpc.buddies.requests.queryOptions(), refetchInterval: 60_000 });
  const profile = useQuery({ ...orpc.buddies.myProfile.queryOptions(), enabled: can("buddies.be_buddy") });
  const [self, setSelf] = useState<BuddyRequest | null>(null);
  const [pickFor, setPickFor] = useState<BuddyRequest | null>(null);
  const [picked, setPicked] = useState<{ r: BuddyRequest; c: BuddyCandidate } | null>(null);
  return (
    <div className="stack">
      <p className="muted">{t("buddy.requests.intro")}</p>
      {q.isPending && <Skeleton lines={2} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="done">{t("buddy.requests.empty")}</Empty>}
      <ul className="cards">
        {q.data?.map((r) => (
          <li key={r.id}>
            <div className="card">
              <div className="card-top">
                <strong className="card-title" dir="ltr">{r.beneficiaryLabel}</strong>
                <LangBadge language={r.language} />
              </div>
              <div className="chips">
                {r.windows.map((w) => <Chip key={w} tone="info" icon="clock">{t(`buddy.window.${w}` as MessageKey)}</Chip>)}
                <Chip tone="muted">{t(`buddy.pref.${r.mode}` as MessageKey)}</Chip>
                {r.proposed && <Chip tone="warn">{t("buddy.requests.proposed")}</Chip>}
              </div>
              <p className="muted small">{t("buddy.requests.since", { when: relativeTime(r.createdAt, lang) })}</p>
              {!r.proposed && (
                <div className="row wrap">
                  {can("buddies.be_buddy") && (
                    <button type="button" className="btn btn-primary btn-small" disabled={!profile.data} title={!profile.data ? t("buddy.profile.none") : undefined} onClick={() => setSelf(r)}>
                      <Icon name="hand" size={16} />
                      {t("buddy.requests.me")}
                    </button>
                  )}
                  {can("buddies.manage") && (
                    <button type="button" className="btn btn-small" onClick={() => setPickFor(r)}>
                      <Icon name="users" size={16} />
                      {t("buddy.requests.find")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {self && <ProposeSheet request={self} candidate={null} profile={profile.data ?? null} onClose={() => setSelf(null)} />}
      {pickFor && <CandidatesSheet request={pickFor} onClose={() => setPickFor(null)} onPick={(c) => { setPicked({ r: pickFor, c }); setPickFor(null); }} />}
      {picked && <ProposeSheet request={picked.r} candidate={picked.c} profile={null} onClose={() => setPicked(null)} />}
    </div>
  );
}

function All() {
  const { t } = useI18n();
  const [status, setStatus] = useState<BuddyMatchStatus>("active");
  const q = useQuery(orpc.buddies.all.queryOptions({ input: { status } }));
  return (
    <div className="stack">
      <Segmented label={t("buddy.filter")} value={status} onChange={setStatus}
        options={(["active", "proposed", "suspended", "ended"] as BuddyMatchStatus[]).map((s) => ({ value: s, label: t(`buddy.status.${s}` as MessageKey) }))} />
      {q.isPending && <Skeleton lines={2} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="people">{t("buddy.all.empty")}</Empty>}
      <ul className="cards">{q.data?.map((m) => <MatchCard key={m.id} m={m} showVolunteer />)}</ul>
    </div>
  );
}

function Reports() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"open" | "closed">("open");
  const q = useQuery(orpc.buddies.reports.queryOptions({ input: { status } }));
  const [open, setOpen] = useState<BuddyReport | null>(null);
  const [note, setNote] = useState("");
  const resolve = useMutation({
    ...orpc.buddies.resolveReport.mutationOptions(),
    onSuccess: () => {
      toast(t("buddy.reports.done"));
      setOpen(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: orpc.buddies.key() });
    },
  });
  return (
    <div className="stack">
      <Segmented label={t("buddy.filter")} value={status} onChange={setStatus}
        options={[{ value: "open" as const, label: t("buddy.reports.open") }, { value: "closed" as const, label: t("buddy.reports.closed") }]} />
      {q.isPending && <Skeleton lines={2} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="done">{t("buddy.reports.empty")}</Empty>}
      <ul className="cards">
        {q.data?.map((r) => (
          <li key={r.id}>
            <div className={`card${r.status === "open" ? " is-attention" : ""}`}>
              <div className="card-top">
                <strong className="card-title">{t(r.by === "beneficiary" ? "buddy.reports.byBeneficiary" : "buddy.reports.byVolunteer", { label: r.beneficiaryLabel, name: r.volunteerName })}</strong>
              </div>
              <p className="long-text" dir="auto">{r.text}</p>
              <p className="muted small">{formatDateTime(r.createdAt, lang)}</p>
              {r.status === "closed" && (
                <p className="muted small">
                  {t(`buddy.reports.resolution.${r.resolution ?? "ended"}` as MessageKey, { name: r.handledByName ?? "—" })}
                  {r.note && <> · <span dir="auto">{r.note}</span></>}
                </p>
              )}
              <div className="row wrap">
                <a className="btn btn-small" href={href("buddies", r.matchId)}>
                  <Icon name="eye" size={16} />
                  {t("buddy.reports.view")}
                </a>
                {r.status === "open" && (
                  <button type="button" className="btn btn-small btn-primary" onClick={() => setOpen(r)}>
                    {t("buddy.reports.handle")}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {open && (
        <Sheet open onClose={() => setOpen(null)} title={t("buddy.reports.handle")}>
          <div className="stack">
            <p className="sheet-text">{t("buddy.reports.handleIntro")}</p>
            <label className="field">
              <span className="field-label">{t("buddy.reports.note")}</span>
              <textarea rows={3} maxLength={500} lang="fr" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {resolve.error && <ErrorBox error={resolve.error} />}
            <div className="stack-tight">
              <button type="button" className="btn btn-block btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: open.id, action: "resume", note })}>
                {t("buddy.reports.resume")}
              </button>
              <button type="button" className="btn btn-block btn-danger-quiet" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: open.id, action: "end", note })}>
                {t("buddy.reports.end")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function BuddyList() {
  const { t } = useI18n();
  const { can } = useSession();
  const counts = useQuery({ ...orpc.buddies.counts.queryOptions(), refetchInterval: 60_000 });
  const tabs: Tab[] = [
    ...(can("buddies.be_buddy") ? (["mine"] as const) : []),
    ...(can("buddies.be_buddy") || can("buddies.manage") ? (["requests"] as const) : []),
    ...(can("buddies.manage") ? (["all"] as const) : []),
    ...(can("buddies.reports") ? (["reports"] as const) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "mine");
  const badge: Partial<Record<Tab, number>> = { requests: counts.data?.waiting, reports: counts.data?.openReports };
  return (
    <section className="stack">
      <h1>{t("buddy.title")}</h1>
      <p className="muted">{t("buddy.intro")}</p>
      {tabs.length > 1 && <Segmented label={t("buddy.tabs")} value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: t(`buddy.tab.${x}` as MessageKey), count: badge[x] }))} />}
      {tab === "mine" && <Mine />}
      {tab === "requests" && <Requests />}
      {tab === "all" && <All />}
      {tab === "reports" && <Reports />}
    </section>
  );
}

// ---------------------------------------------------------------- detail

export function BuddyDetail({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { volunteer, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ ...orpc.buddies.get.queryOptions({ input: { id } }), refetchInterval: 30_000 });
  const [text, setText] = useState("");
  const [dialog, setDialog] = useState<"end" | "report" | null>(null);
  const [report, setReport] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const refresh = (d?: BuddyMatchDetail) => {
    if (d) qc.setQueryData(orpc.buddies.get.queryKey({ input: { id } }), d);
    void qc.invalidateQueries({ queryKey: orpc.buddies.key() });
  };
  const send = useMutation({ ...orpc.buddies.sendMessage.mutationOptions(), onSuccess: (d) => { setText(""); refresh(d); } });
  const skip = useMutation({ ...orpc.buddies.skipSession.mutationOptions(), onSuccess: (d) => { toast(t("buddy.detail.skipped")); refresh(d); } });
  const end = useMutation({ ...orpc.buddies.end.mutationOptions(), onSuccess: () => { setDialog(null); refresh(); } });
  const rep = useMutation({ ...orpc.buddies.report.mutationOptions(), onSuccess: () => { setDialog(null); setReport(""); toast(t("buddy.detail.reported")); refresh(); } });
  const contact = useMutation({ ...orpc.buddies.contact.mutationOptions(), onSuccess: (r) => setPhone(r.phone) });

  if (q.isPending) return <Skeleton lines={4} />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const m = q.data;
  const own = m.volunteer.id === volunteer.id && can("buddies.be_buddy");
  const active = m.status === "active";
  const open = m.status === "proposed" || m.status === "active" || m.status === "suspended";

  return (
    <section className="stack">
      <BackLink to={href("buddies")}>{t("buddy.title")}</BackLink>
      <div className="card stack-tight">
        <div className="card-top">
          <h1 className="card-title" dir="ltr">{m.beneficiaryLabel}</h1>
          <LangBadge language={m.beneficiaryLanguage} />
        </div>
        <div className="chips">
          <StatusChip status={m.status} />
          <Chip tone="muted" icon={m.mode === "call" ? "phone" : "building"}>{t(`buddy.mode.${m.mode}` as MessageKey)}</Chip>
          <Chip tone="muted" icon="clock">{t("buddy.weekly", { slot: slotLabel(m, lang) })}</Chip>
          {m.contactShared && <Chip tone="ok" icon="phone">{t("buddy.detail.consent")}</Chip>}
        </div>
        {!own && <p className="muted small">{t("buddy.with", { name: m.volunteer.name })}</p>}
        {m.place && <p className="small"><Icon name="building" size={14} /> <span dir="auto">{m.place}</span></p>}
        {m.nextSession && <p><strong>{t("buddy.next", { date: formatDateTime(m.nextSession.startsAt, lang) })}</strong></p>}
        {m.status === "suspended" && <p className="callout callout-urgent callout-small">{t("buddy.detail.suspended")}</p>}
        {m.status === "proposed" && <p className="callout callout-info callout-small">{t("buddy.detail.proposed")}</p>}
        {own && (
          <div className="row wrap">
            {active && m.nextSession && (
              <button type="button" className="btn btn-small" disabled={skip.isPending} onClick={() => skip.mutate({ sessionId: m.nextSession!.id })}>
                <Icon name="calendar" size={16} />
                {t("buddy.detail.skip")}
              </button>
            )}
            {active && m.contactShared && (
              phone ? <a className="btn btn-small" href={`tel:${phone}`} dir="ltr"><Icon name="phone" size={16} />{phone}</a>
                : (
                  <button type="button" className="btn btn-small" disabled={contact.isPending} onClick={() => contact.mutate({ matchId: m.id })}>
                    <Icon name="eye" size={16} />
                    {t("buddy.detail.showNumber")}
                  </button>
                )
            )}
            {open && (
              <button type="button" className="btn btn-small btn-danger-quiet" onClick={() => setDialog("report")}>
                <Icon name="alert" size={16} />
                {t("buddy.detail.report")}
              </button>
            )}
          </div>
        )}
        {open && (own || can("buddies.manage")) && (
          <div className="row">
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setDialog("end")}>
              <Icon name="x" size={16} />
              {t("buddy.detail.end")}
            </button>
          </div>
        )}
        {contact.error && <ErrorBox error={contact.error} />}
      </div>

      {m.messages !== null && (
        <div className="stack">
          <h2>{t("buddy.detail.messages")}</h2>
          {!own && <p className="callout callout-info callout-small">{t("buddy.detail.reviewNote")}</p>}
          {m.messages.length === 0 && <p className="muted">{t("buddy.detail.noMessages")}</p>}
          <ol className="thread">
            {m.messages.map((x) => (
              <li key={x.id} className={`bubble bubble-${x.author === "volunteer" ? "volunteer" : "beneficiary"}`}>
                <div className="bubble-meta small"><span className="bubble-who">{x.author === "volunteer" ? m.volunteer.name : m.beneficiaryLabel}</span> · {formatDateTime(x.at, lang)}</div>
                <p className="bubble-text long-text" dir="auto">{x.text}</p>
              </li>
            ))}
          </ol>
          {own && active && (
            <form className="stack-tight" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate({ matchId: m.id, text }); }}>
              <label className="field">
                <span className="field-label">{t("buddy.detail.write")}</span>
                <textarea rows={3} maxLength={1000} dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
                <span className="muted small">{t("buddy.detail.writeHint")}</span>
              </label>
              {send.error && <ErrorBox error={send.error} />}
              <button type="submit" className="btn btn-primary" disabled={send.isPending || !text.trim()}>
                <Icon name="send" size={18} />
                {t("buddy.detail.send")}
              </button>
            </form>
          )}
        </div>
      )}

      {m.sessions.length > 0 && (
        <div className="stack-tight">
          <h2>{t("buddy.detail.sessions")}</h2>
          <ul className="stack-tight">
            {m.sessions.map((s) => (
              <li key={s.id} className="row between">
                <span>{formatDateTime(s.startsAt, lang)}</span>
                <Chip tone={s.status === "scheduled" ? "info" : s.status === "done" ? "ok" : "muted"}>{t(`buddy.session.${s.status}` as MessageKey)}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmSheet open={dialog === "end"} title={t("buddy.detail.end")} body={t("buddy.detail.endBody")} confirmLabel={t("buddy.detail.end")} tone="danger"
        busy={end.isPending} onConfirm={() => end.mutate({ matchId: m.id })} onClose={() => setDialog(null)} />
      {dialog === "report" && (
        <Sheet open onClose={() => setDialog(null)} title={t("buddy.detail.report")}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); rep.mutate({ matchId: m.id, text: report }); }}>
            <p className="sheet-text">{t("buddy.detail.reportIntro")}</p>
            <textarea rows={4} maxLength={2000} lang="fr" dir="auto" value={report} onChange={(e) => setReport(e.target.value)} aria-label={t("buddy.detail.report")} />
            {rep.error && <ErrorBox error={rep.error} />}
            <button type="submit" className="btn btn-block btn-primary" disabled={rep.isPending || report.trim().length < 3}>{t("buddy.detail.reportSend")}</button>
          </form>
        </Sheet>
      )}
    </section>
  );
}
