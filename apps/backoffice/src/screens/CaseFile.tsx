import type { CaseNote, CaseTask, DirectoryEntry, VolunteerSkill } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";
import { relativeTime } from "../lib/relative";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";

/* Case notes and follow-up tasks on one person. Shared by the person page and the conversation screen. */

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: orpc.notes.key() });
  void qc.invalidateQueries({ queryKey: orpc.tasks.key() });
};

function errorText(t: ReturnType<typeof useI18n>["t"], error: unknown): string {
  const c = errorCode(error);
  if (c === "FORBIDDEN") return t("error.forbidden");
  if (c === "CONFLICT") return t("tasks.assigneeCannotView");
  return t("error.generic");
}

/** Volunteers a task can be given to: the directory (skills.view) filtered to those who can read notes. */
function useAssignees(enabled: boolean) {
  const q = useQuery({ ...orpc.skills.directory.queryOptions({ input: {} }), enabled, staleTime: 5 * 60_000, retry: false });
  return (q.data ?? []).filter((e) => e.canTakeTasks);
}

export function DueChip({ task }: { task: CaseTask }) {
  const { t, lang } = useI18n();
  if (task.status === "done") return <Chip tone="ok" icon="checkCircle">{t("tasks.status.done")}</Chip>;
  if (task.status === "cancelled") return <Chip tone="muted" icon="x">{t("tasks.status.cancelled")}</Chip>;
  if (!task.dueOn) return null;
  return (
    <Chip tone={task.due ? "urgent" : "info"} icon="bell">
      {task.due && task.dueOn < todayParis() ? t("tasks.overdue", { date: formatDate(task.dueOn, lang) }) : t("tasks.dueOn", { date: formatDate(task.dueOn, lang) })}
    </Chip>
  );
}

export function TaskCard({ task, showPerson }: { task: CaseTask; showPerson?: boolean }) {
  const { t, lang } = useI18n();
  const { can, volunteer: me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useMutation({
    ...orpc.tasks.update.mutationOptions(),
    onSuccess: (x) => {
      toast(x.status === "done" ? t("tasks.doneToast") : t("tasks.savedToast"));
      invalidate(qc);
    },
    onError: (e) => toast(errorText(t, e), "error"),
  });
  const canWrite = can("notes.write");
  const open = task.status === "open";
  const personHref = can("conversations.view") ? href("conversations", task.beneficiaryId) : href("beneficiaries", task.beneficiaryId);
  return (
    <div className={`card task-card${task.due ? " is-due" : ""}${open ? "" : " is-closed"}`}>
      <div className="task-row">
        {canWrite && (
          <label className="check task-check">
            <input
              type="checkbox"
              checked={task.status === "done"}
              disabled={update.isPending || task.status === "cancelled"}
              onChange={(e) => update.mutate({ id: task.id, status: e.target.checked ? "done" : "open" })}
            />
            <span className="visually-hidden">{t("tasks.markDone")}</span>
          </label>
        )}
        <div className="task-main">
          <p className="task-text" lang="fr">{task.text}</p>
          <div className="chips">
            <DueChip task={task} />
            {task.assignee ? (
              <span className="muted small">{task.assignee.id === me.id ? t("tasks.assignedToYou") : t("tasks.assignedTo", { name: `⁨${task.assignee.name}⁩` })}</span>
            ) : (
              <span className="muted small">{t("tasks.unassigned")}</span>
            )}
          </div>
          {showPerson && (
            <a className="task-person" href={personHref}>
              <span dir="ltr">{task.beneficiaryLabel}</span>
              <LangBadge language={task.language} />
              <Icon name="chevron" size={16} />
            </a>
          )}
          <span className="muted small">
            {task.createdBy ? t("tasks.createdBy", { name: `⁨${task.createdBy.name}⁩`, when: relativeTime(task.createdAt, lang) }) : relativeTime(task.createdAt, lang)}
          </span>
        </div>
      </div>
      {canWrite && open && (
        <div className="row wrap">
          {!task.assignee && (
            <button type="button" className="btn btn-small" disabled={update.isPending} onClick={() => update.mutate({ id: task.id, assigneeId: me.id })}>
              <Icon name="hand" size={16} />
              {t("tasks.takeIt")}
            </button>
          )}
          {task.dueOn && (
            <button type="button" className="btn btn-small btn-quiet" disabled={update.isPending} onClick={() => update.mutate({ id: task.id, dueOn: addDays(todayParis(), 7) })}>
              <Icon name="clock" size={16} />
              {t("tasks.snooze")}
            </button>
          )}
          {task.canEdit && (
            <button type="button" className="btn btn-small btn-quiet" disabled={update.isPending} onClick={() => update.mutate({ id: task.id, status: "cancelled" })}>
              <Icon name="x" size={16} />
              {t("tasks.cancel")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const QUICK_DAYS = [1, 7, 14, 30] as const;

/** New task form. `preset` fills the text and assignee (from "who can help"). */
export function TaskForm({ beneficiaryId, preset, onDone }: { beneficiaryId: string; preset?: { text: string; assignee: DirectoryEntry }; onDone?: () => void }) {
  const { t } = useI18n();
  const { can, volunteer: me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canAssign = can("tasks.assign");
  const assignees = useAssignees(canAssign && can("skills.view"));
  const [text, setText] = useState(preset?.text ?? "");
  const [dueOn, setDueOn] = useState(addDays(todayParis(), 7));
  const [withDate, setWithDate] = useState(true);
  const [assigneeId, setAssigneeId] = useState<string>(preset?.assignee.volunteerId ?? me.id);
  const add = useMutation({
    ...orpc.tasks.add.mutationOptions(),
    onSuccess: () => {
      setText("");
      toast(t("tasks.addedToast"));
      invalidate(qc);
      onDone?.();
    },
  });
  const others = assignees.filter((a) => a.volunteerId !== me.id);
  if (preset && !others.some((a) => a.volunteerId === preset.assignee.volunteerId)) others.unshift(preset.assignee);
  return (
    <form
      className="stack-tight"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) add.mutate({ beneficiaryId, text: text.trim(), dueOn: withDate ? dueOn : null, assigneeId: assigneeId || null });
      }}
    >
      <label className="field">
        <span className="field-label">{t("tasks.what")}</span>
        <input value={text} maxLength={500} lang="fr" placeholder={t("tasks.placeholder")} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
        <span>{t("tasks.remindMe")}</span>
      </label>
      {withDate && (
        <>
          <div className="row wrap" role="group" aria-label={t("tasks.quickDates")}>
            {QUICK_DAYS.map((d) => (
              <button key={d} type="button" className={`btn btn-small${dueOn === addDays(todayParis(), d) ? " btn-primary" : ""}`} onClick={() => setDueOn(addDays(todayParis(), d))}>
                {t(`tasks.in.${d}` as MessageKey)}
              </button>
            ))}
          </div>
          <DateField label={t("tasks.dueLabel")} value={dueOn} onChange={setDueOn} previewKey="tasks.duePreview" />
        </>
      )}
      <label className="field">
        <span className="field-label">{t("tasks.who")}</span>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value={me.id}>{t("tasks.me")}</option>
          <option value="">{t("tasks.anyone")}</option>
          {canAssign && others.map((a) => <option key={a.volunteerId} value={a.volunteerId}>{a.name}</option>)}
        </select>
      </label>
      {add.isError && <p className="notice notice-error" role="alert"><Icon name="alert" /><span className="notice-body">{errorText(t, add.error)}</span></p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={add.isPending || !text.trim()}>
        <Icon name="plus" size={18} />
        {t("tasks.add")}
      </button>
    </form>
  );
}

function NoteCard({ note }: { note: CaseNote }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [confirm, setConfirm] = useState(false);
  const edit = useMutation({
    ...orpc.notes.edit.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      invalidate(qc);
    },
  });
  const remove = useMutation({
    ...orpc.notes.remove.mutationOptions(),
    onSuccess: () => {
      setConfirm(false);
      toast(t("notes.removedToast"), "info");
      invalidate(qc);
    },
  });
  return (
    <div className="card note-card">
      <div className="note-meta muted small">
        <strong>{note.author?.name ?? t("notes.formerVolunteer")}</strong>
        <span>{relativeTime(note.createdAt, lang)}</span>
        {note.editedAt && <span>{t("notes.edited")}</span>}
      </div>
      {editing ? (
        <form
          className="stack-tight"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) edit.mutate({ id: note.id, text: text.trim() });
          }}
        >
          <textarea rows={4} maxLength={4000} lang="fr" value={text} onChange={(e) => setText(e.target.value)} aria-label={t("notes.editLabel")} />
          <div className="row wrap">
            <button type="submit" className="btn btn-small btn-primary" disabled={edit.isPending || !text.trim()}>{t("notes.save")}</button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => { setEditing(false); setText(note.text); }}>{t("common.cancel")}</button>
          </div>
        </form>
      ) : (
        <p className="note-text" lang="fr">{note.text}</p>
      )}
      {note.canEdit && !editing && (
        <div className="row wrap">
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
            {t("notes.edit")}
          </button>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={16} />
            {t("notes.remove")}
          </button>
        </div>
      )}
      <ConfirmSheet open={confirm} title={t("notes.removeTitle")} body={t("notes.removeBody")} confirmLabel={t("notes.remove")} tone="danger" busy={remove.isPending} onConfirm={() => remove.mutate({ id: note.id })} onClose={() => setConfirm(false)} />
    </div>
  );
}

/** Notes + tasks of one person. Renders nothing for someone without notes.view. */
export function CaseFilePanel({ beneficiaryId }: { beneficiaryId: string }) {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const canView = can("notes.view");
  const canWrite = can("notes.write");
  const query = useQuery({ ...orpc.notes.list.queryOptions({ input: { beneficiaryId } }), enabled: canView });
  const [text, setText] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const add = useMutation({
    ...orpc.notes.add.mutationOptions(),
    onSuccess: () => {
      setText("");
      invalidate(qc);
    },
  });
  if (!canView && !canWrite) return null;
  const tasks = query.data?.tasks ?? [];
  const openTasks = tasks.filter((x) => x.status === "open");
  const closed = tasks.filter((x) => x.status !== "open");
  return (
    <div className="stack case-file">
      <p className="muted small case-file-privacy">
        <Icon name="shield" size={14} /> {t("notes.privacy")}
      </p>
      <div className="row space-between">
        <h2 className="section-title">{t("tasks.title")}</h2>
        {canWrite && (
          <button type="button" className="btn btn-small" onClick={() => setTaskOpen(true)}>
            <Icon name="plus" size={16} />
            {t("tasks.new")}
          </button>
        )}
      </div>
      {canView && query.isPending && <Skeleton lines={1} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && openTasks.length === 0 && <p className="muted">{t("tasks.noneOpen")}</p>}
      <ul className="cards">
        {openTasks.map((x) => <li key={x.id}><TaskCard task={x} /></li>)}
      </ul>
      {closed.length > 0 && (
        <details className="closed-tasks">
          <summary>{t("tasks.closedCount", { n: closed.length })}</summary>
          <ul className="cards">
            {closed.map((x) => <li key={x.id}><TaskCard task={x} /></li>)}
          </ul>
        </details>
      )}

      <h2 className="section-title">{t("notes.title")}</h2>
      {canWrite && (
        <form
          className="stack-tight"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate({ beneficiaryId, text: text.trim() });
          }}
        >
          <textarea rows={3} maxLength={4000} lang="fr" value={text} placeholder={t("notes.placeholder")} aria-label={t("notes.addLabel")} onChange={(e) => setText(e.target.value)} />
          {add.isError && <p className="notice notice-error" role="alert"><Icon name="alert" /><span className="notice-body">{errorText(t, add.error)}</span></p>}
          <button type="submit" className="btn btn-primary" disabled={add.isPending || !text.trim()}>{t("notes.add")}</button>
        </form>
      )}
      {canView && query.isSuccess && query.data.notes.length === 0 && <Empty art="book">{t("notes.empty")}</Empty>}
      <ul className="cards">
        {query.data?.notes.map((n) => <li key={n.id}><NoteCard note={n} /></li>)}
      </ul>
      <Sheet open={taskOpen} onClose={() => setTaskOpen(false)} title={t("tasks.new")}>
        <TaskForm beneficiaryId={beneficiaryId} onDone={() => setTaskOpen(false)} />
      </Sheet>
    </div>
  );
}

export function SkillChips({ skills, highlight }: { skills: VolunteerSkill[]; highlight?: VolunteerSkill[] }) {
  const { t } = useI18n();
  return (
    <>
      {skills.map((s) => (
        <Chip key={s} tone={highlight?.includes(s) ? "ok" : "muted"}>{t(`skill.${s}` as MessageKey)}</Chip>
      ))}
    </>
  );
}

/** "Who can help?": volunteers matching the person's language and latest question, with a one-tap task for them. */
export function HelpersSheet({ beneficiaryId, open, onClose }: { beneficiaryId: string; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const query = useQuery({ ...orpc.skills.suggest.queryOptions({ input: { beneficiaryId } }), enabled: open });
  const [assign, setAssign] = useState<DirectoryEntry | null>(null);
  const canGive = can("notes.write") && can("tasks.assign");
  const s = query.data;
  return (
    <Sheet open={open} onClose={() => { setAssign(null); onClose(); }} title={assign ? t("helpers.giveTitle", { name: assign.name }) : t("helpers.title")}>
      {assign ? (
        <TaskForm
          beneficiaryId={beneficiaryId}
          preset={{ assignee: assign, text: s && s.language !== "fr" ? t("helpers.presetLang", { language: LANGUAGES[s.language].nativeName }) : t("helpers.preset") }}
          onDone={() => { setAssign(null); onClose(); }}
        />
      ) : (
        <div className="stack">
          {query.isPending && <Skeleton lines={2} />}
          {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
          {s && (
            <p className="muted small">
              {t("helpers.lookingFor")} <LangBadge language={s.language} /> <SkillChips skills={s.wanted.filter((w) => w !== "interpreting")} />
            </p>
          )}
          {s && s.volunteers.length === 0 && <Empty art="people" sub={t("helpers.noneSub")}>{t("helpers.none")}</Empty>}
          <ul className="cards">
            {s?.volunteers.map((v) => (
              <li key={v.volunteerId} className="card">
                <strong>{v.name}</strong>
                <div className="chips">
                  {v.speaksLanguage && <Chip tone="ok" icon="globe">{t("helpers.speaks", { language: LANGUAGES[s.language].nativeName })}</Chip>}
                  <SkillChips skills={v.matchedSkills.filter((m) => m !== "interpreting")} highlight={v.matchedSkills} />
                </div>
                {v.note && <p className="muted small">{v.note}</p>}
                {canGive && v.canTakeTasks && (
                  <button type="button" className="btn btn-small" onClick={() => setAssign(v)}>
                    <Icon name="send" size={16} />
                    {t("helpers.give")}
                  </button>
                )}
                {!v.canTakeTasks && <span className="muted small">{t("helpers.cannotTakeTasks")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
