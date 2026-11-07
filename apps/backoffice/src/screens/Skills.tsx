import type { DirectoryEntry, LanguageCode, SkillsInput, VolunteerSkill } from "@wilson/contracts";
import { LANGUAGE_CODES, LANGUAGES, VOLUNTEER_SKILLS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LangBadge } from "../components/badges";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { useSession } from "../lib/session";
import { SkillChips } from "./CaseFile";

const OTHER_LANGUAGES = LANGUAGE_CODES.filter((c) => c !== "fr");

/** Languages + skills + note. Used for your own profile and by admins for someone else's. */
function SkillsForm({ initial, busy, onSave }: { initial: SkillsInput; busy: boolean; onSave: (v: SkillsInput) => void }) {
  const { t } = useI18n();
  const [languages, setLanguages] = useState<LanguageCode[]>(initial.languages);
  const [skills, setSkills] = useState<VolunteerSkill[]>(initial.skills);
  const [note, setNote] = useState(initial.note ?? "");
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ languages, skills, note: note.trim() || null });
      }}
    >
      <fieldset className="stack-tight">
        <legend className="field-label">{t("skills.languages")}</legend>
        <small className="muted">{t("skills.languagesHelp")}</small>
        <div className="toggle-chips">
          {OTHER_LANGUAGES.map((code) => (
            <button key={code} type="button" aria-pressed={languages.includes(code)} className="toggle-chip" lang={code} dir={LANGUAGES[code].dir} onClick={() => setLanguages(toggle(languages, code))}>
              {LANGUAGES[code].nativeName}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack-tight">
        <legend className="field-label">{t("skills.skills")}</legend>
        {VOLUNTEER_SKILLS.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={skills.includes(s)} onChange={() => setSkills(toggle(skills, s))} />
            <span>
              {t(`skill.${s}` as MessageKey)}
              <small className="muted block">{t(`skill.${s}.desc` as MessageKey)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field-label">{t("skills.note")}</span>
        <input value={note} maxLength={300} placeholder={t("skills.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        <small className="muted">{t("skills.noteHelp")}</small>
      </label>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        <Icon name="check" size={18} />
        {t("skills.save")}
      </button>
    </form>
  );
}

function MySkills() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(orpc.skills.mine.queryOptions());
  const save = useMutation({
    ...orpc.skills.updateMine.mutationOptions(),
    onSuccess: (d) => {
      qc.setQueryData(orpc.skills.mine.queryKey(), d);
      void qc.invalidateQueries({ queryKey: orpc.skills.directory.key() });
      toast(t("skills.savedToast"));
    },
    onError: () => toast(t("error.generic"), "error"),
  });
  return (
    <section className="card stack">
      <h2>{t("skills.mine")}</h2>
      <p className="muted small">{t("skills.mineIntro")}</p>
      {query.isPending && <Skeleton lines={2} card={false} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.data && <SkillsForm key={query.data.updatedAt ?? "new"} initial={query.data} busy={save.isPending} onSave={(v) => save.mutate(v)} />}
    </section>
  );
}

function Directory() {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [language, setLanguage] = useState<LanguageCode | "">("");
  const [skill, setSkill] = useState<VolunteerSkill | "">("");
  const [editing, setEditing] = useState<DirectoryEntry | null>(null);
  const query = useQuery(orpc.skills.directory.queryOptions({ input: { language: language || undefined, skill: skill || undefined } }));
  const save = useMutation({
    ...orpc.skills.updateFor.mutationOptions(),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: orpc.skills.key() });
      toast(t("skills.savedToast"));
    },
  });
  const isAdmin = can("volunteers.manage");
  return (
    <section className="stack">
      <h2 className="section-title">{t("skills.directory")}</h2>
      <div className="row wrap">
        <label className="field grow">
          <span className="field-label">{t("skills.filterLanguage")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode | "")}>
            <option value="">{t("skills.all")}</option>
            {OTHER_LANGUAGES.map((c) => <option key={c} value={c} lang={c} dir={LANGUAGES[c].dir}>{LANGUAGES[c].nativeName}</option>)}
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">{t("skills.filterSkill")}</span>
          <select value={skill} onChange={(e) => setSkill(e.target.value as VolunteerSkill | "")}>
            <option value="">{t("skills.all")}</option>
            {VOLUNTEER_SKILLS.map((s) => <option key={s} value={s}>{t(`skill.${s}` as MessageKey)}</option>)}
          </select>
        </label>
      </div>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && query.data.length === 0 && <Empty art="people">{t("skills.empty")}</Empty>}
      <ul className="cards">
        {query.data?.map((e) => (
          <li key={e.volunteerId} className="card stack-tight">
            <div className="row space-between">
              <strong>{e.name}</strong>
              <span className="muted small">{t(`vol.role.${e.role}` as MessageKey)}</span>
            </div>
            <div className="chips">
              {e.languages.map((l) => <LangBadge key={l} language={l} />)}
              <SkillChips skills={e.skills} highlight={skill ? [skill] : undefined} />
            </div>
            {e.note && <p className="muted small">{e.note}</p>}
            {isAdmin && (
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setEditing(e)}>
                <Icon name="edit" size={16} />
                {t("skills.editFor")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing ? t("skills.editForTitle", { name: editing.name }) : ""}>
        {editing && <SkillsForm initial={editing} busy={save.isPending} onSave={(v) => save.mutate({ ...v, volunteerId: editing.volunteerId })} />}
      </Sheet>
    </section>
  );
}

/** Compétences: fill in your own profile; browse who can do what (skills.view). */
export function Skills() {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <section className="stack-lg">
      <h1>{t("skills.title")}</h1>
      {can("skills.edit_own") && <MySkills />}
      {can("skills.view") && <Directory />}
    </section>
  );
}
