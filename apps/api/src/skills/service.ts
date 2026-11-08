import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { ChatIntent, DirectoryEntry, LanguageCode, SkillMatch, SkillsInput, VolunteerSkill, VolunteerSkills, VolunteerRole } from "@wilson/contracts";
import { permissionsOf } from "../auth/service.js";
import type { Db } from "../db/client.js";
import { beneficiaries, messages, volunteerSkills, volunteers } from "../db/schema.js";

type SkillsRow = typeof volunteerSkills.$inferSelect;

const toSkills = (r: SkillsRow | undefined): VolunteerSkills => ({
  languages: (r?.languages ?? []) as LanguageCode[],
  skills: (r?.skills ?? []) as VolunteerSkill[],
  note: r?.note ?? null,
  updatedAt: r?.updatedAt.toISOString() ?? null,
});

export async function getSkills(db: Db, volunteerId: string): Promise<VolunteerSkills> {
  const [r] = await db.select().from(volunteerSkills).where(eq(volunteerSkills.volunteerId, volunteerId));
  return toSkills(r);
}

export async function setSkills(db: Db, volunteerId: string, input: SkillsInput, now: Date): Promise<VolunteerSkills> {
  const values = { languages: input.languages, skills: input.skills, note: input.note || null, updatedAt: now };
  const [r] = await db.insert(volunteerSkills).values({ volunteerId, ...values })
    .onConflictDoUpdate({ target: volunteerSkills.volunteerId, set: values }).returning();
  return toSkills(r);
}

/** Active, approved volunteers who filled in their profile, with whether they can receive tasks (notes.view). */
export async function directory(db: Db, filter: { language?: LanguageCode; skill?: VolunteerSkill } = {}): Promise<DirectoryEntry[]> {
  const rows = await db
    .select({ s: volunteerSkills, id: volunteers.id, name: volunteers.name, role: volunteers.role })
    .from(volunteerSkills)
    .innerJoin(volunteers, eq(volunteers.id, volunteerSkills.volunteerId))
    .where(and(isNull(volunteers.disabledAt), eq(volunteers.pendingApproval, false)))
    .orderBy(asc(volunteers.name));
  const perms = await permissionsOf(db, rows.map((r) => r.id));
  return rows
    .map((r) => ({
      ...toSkills(r.s),
      volunteerId: r.id,
      name: r.name,
      role: r.role as VolunteerRole,
      canTakeTasks: perms.get(r.id)?.includes("notes.view") ?? false,
    }))
    .filter((e) => (e.languages.length > 0 || e.skills.length > 0)
      && (!filter.language || e.languages.includes(filter.language))
      && (!filter.skill || e.skills.includes(filter.skill)));
}

/** Skills that help with a chat intent. Language is matched separately. */
const SKILLS_FOR_INTENT: Record<ChatIntent, VolunteerSkill[]> = {
  legal: ["legal", "asylum"],
  urgent: ["housing", "accompaniment", "health"],
  places: ["housing"],
  letter: ["forms", "legal"],
  document: ["forms", "digital"],
  human: [],
  info: [],
  smalltalk: [],
  out_of_scope: [],
};

/**
 * Volunteers who could help with a person: same language (except French, which everyone speaks) and/or the skills
 * `wanted`. Score: language 2 points, each matching skill 1 point. Shared with other features (appointments, buddies).
 */
export async function matchVolunteers(db: Db, want: { language?: LanguageCode; skills?: VolunteerSkill[] }, limit = 10): Promise<SkillMatch[]> {
  const lang = want.language && want.language !== "fr" ? want.language : null;
  const skills = want.skills ?? [];
  return (await directory(db))
    .map((e) => {
      const speaksLanguage = lang !== null && e.languages.includes(lang);
      // Interpreting only helps in the person's language.
      const matchedSkills = skills.filter((s) => e.skills.includes(s) && (s !== "interpreting" || speaksLanguage));
      return { ...e, speaksLanguage, matchedSkills, score: (speaksLanguage ? 2 : 0) + matchedSkills.length };
    })
    .filter((m) => m.score > 0)
    .sort((a, z) => z.score - a.score || Number(z.canTakeTasks) - Number(a.canTakeTasks) || a.name.localeCompare(z.name, "fr"))
    .slice(0, limit)
    .map(({ score: _score, ...m }) => m);
}

/** Language + latest classified chat intent of a person (no message content is read). null = unknown person. */
export async function needsOf(db: Db, beneficiaryId: string): Promise<{ language: LanguageCode; wanted: VolunteerSkill[] } | null> {
  const [b] = await db.select({ language: beneficiaries.language }).from(beneficiaries).where(eq(beneficiaries.id, beneficiaryId));
  if (!b) return null;
  const [m] = await db.select({ intent: messages.intent }).from(messages)
    .where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.author, "beneficiary"), isNotNull(messages.intent)))
    .orderBy(desc(messages.createdAt)).limit(1);
  const wanted = m?.intent ? SKILLS_FOR_INTENT[m.intent as ChatIntent] : [];
  return { language: b.language, wanted: b.language !== "fr" ? [...new Set<VolunteerSkill>(["interpreting", ...wanted])] : wanted };
}
