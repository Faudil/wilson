import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { BackupCall, BackupInput, LanguageCode, Volunteer, VolunteerSkill } from "@wilson/contracts";
import { backupCalls, backupOffers, volunteerSkills } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { DomainError } from "../errors.js";
import { localDate } from "../time.js";
import { associationNames, isGlobalAdmin, sameAssociation, volunteerNames } from "./scope.js";

type Row = typeof backupCalls.$inferSelect;
type BackupDeps = Pick<Deps, "db" | "config" | "now">;

export class BackupError extends DomainError {
  constructor(code: "NOT_FOUND" | "FORBIDDEN" | "CONFLICT", reason?: string) {
    super(code, reason);
    this.name = "BackupError";
  }
}

/** Mark covered / cancel: the author, a global admin, or the admin of the call's association. */
export function canClose(v: Volunteer, r: Pick<Row, "authorId" | "associationId">): boolean {
  if (r.authorId === v.id || isGlobalAdmin(v)) return true;
  return r.associationId !== null && sameAssociation(v, r.associationId) && v.permissions.includes("members.manage");
}

export function createBackupService(deps: BackupDeps) {
  const { db } = deps;
  const today = () => localDate(deps.now(), deps.config.TIMEZONE);

  /** Own association (a missing one being its own group), calls open to all, or everything for global admins. */
  const visible = (v: Volunteer) => {
    if (isGlobalAdmin(v)) return sql`true`;
    const own = v.association ? eq(backupCalls.associationId, v.association.id) : isNull(backupCalls.associationId);
    return or(own, eq(backupCalls.openToAll, true))!;
  };

  async function profileOf(id: string): Promise<{ languages: LanguageCode[]; skills: VolunteerSkill[] }> {
    const [r] = await db.select().from(volunteerSkills).where(eq(volunteerSkills.volunteerId, id)).limit(1);
    return { languages: (r?.languages ?? []) as LanguageCode[], skills: (r?.skills ?? []) as VolunteerSkill[] };
  }

  /** A language other than French, or a skill, that the caller listed on their profile. */
  const matches = (r: Pick<Row, "languages" | "skills">, p: { languages: LanguageCode[]; skills: VolunteerSkill[] }) =>
    r.languages.some((l) => l !== "fr" && p.languages.includes(l as LanguageCode)) || r.skills.some((s) => p.skills.includes(s as VolunteerSkill));

  async function toCalls(rows: Row[], v: Volunteer): Promise<BackupCall[]> {
    if (rows.length === 0) return [];
    const offers = await db.select().from(backupOffers).where(inArray(backupOffers.callId, rows.map((r) => r.id))).orderBy(asc(backupOffers.createdAt));
    const [assoc, names, profile] = await Promise.all([
      associationNames(db, rows.map((r) => r.associationId)),
      volunteerNames(db, [...rows.map((r) => r.authorId), ...offers.map((o) => o.volunteerId)]),
      profileOf(v.id),
    ]);
    return rows.map((r) => {
      const mine = offers.filter((o) => o.callId === r.id);
      const closer = canClose(v, r);
      return {
        id: r.id, title: r.title, details: r.details, neededOn: r.neededOn, startsAt: r.startsAt, place: r.place,
        languages: r.languages as LanguageCode[], skills: r.skills as VolunteerSkill[], needed: r.needed, openToAll: r.openToAll,
        status: r.status, association: r.associationId ? { id: r.associationId, name: assoc.get(r.associationId) ?? "" } : null,
        authorId: r.authorId, authorName: r.authorId ? (names.get(r.authorId) ?? null) : null, createdAt: r.createdAt.toISOString(),
        mine: r.authorId === v.id,
        forMe: r.authorId !== v.id && matches(r, profile),
        offered: mine.some((o) => o.volunteerId === v.id),
        offerCount: mine.length,
        offers: closer ? mine.map((o) => ({ volunteerId: o.volunteerId, name: names.get(o.volunteerId) ?? "", note: o.note, at: o.createdAt.toISOString() })) : null,
        canClose: closer,
      };
    });
  }

  async function mustVisible(id: string, v: Volunteer): Promise<Row> {
    const [r] = await db.select().from(backupCalls).where(and(eq(backupCalls.id, id), visible(v))).limit(1);
    if (!r) throw new BackupError("NOT_FOUND");
    return r;
  }

  const stillOpen = (r: Row) => r.status === "open" && r.neededOn >= today();

  async function one(id: string, v: Volunteer): Promise<BackupCall> {
    return (await toCalls([await mustVisible(id, v)], v))[0]!;
  }

  return {
    async list(v: Volunteer, scope: "open" | "mine" | "past"): Promise<BackupCall[]> {
      const d = today();
      if (scope === "open") {
        // Soonest first: what is needed tomorrow comes before next week.
        const rows = await db.select().from(backupCalls).where(and(visible(v), eq(backupCalls.status, "open"), gte(backupCalls.neededOn, d)))
          .orderBy(asc(backupCalls.neededOn), asc(backupCalls.startsAt), asc(backupCalls.createdAt));
        return toCalls(rows, v);
      }
      if (scope === "mine") {
        const offered = db.select({ id: backupOffers.callId }).from(backupOffers).where(eq(backupOffers.volunteerId, v.id));
        const rows = await db.select().from(backupCalls)
          .where(and(visible(v), or(eq(backupCalls.authorId, v.id), inArray(backupCalls.id, offered)), eq(backupCalls.status, "open"), gte(backupCalls.neededOn, d)))
          .orderBy(asc(backupCalls.neededOn), asc(backupCalls.startsAt));
        return toCalls(rows, v);
      }
      const rows = await db.select().from(backupCalls).where(and(visible(v), or(ne(backupCalls.status, "open"), lt(backupCalls.neededOn, d))))
        .orderBy(desc(backupCalls.neededOn), desc(backupCalls.createdAt)).limit(50);
      return toCalls(rows, v);
    },

    async counts(v: Volunteer): Promise<{ open: number; forMe: number }> {
      const offered = db.select({ id: backupOffers.callId }).from(backupOffers).where(eq(backupOffers.volunteerId, v.id));
      const rows = await db.select().from(backupCalls).where(and(
        visible(v), eq(backupCalls.status, "open"), gte(backupCalls.neededOn, today()),
        or(isNull(backupCalls.authorId), ne(backupCalls.authorId, v.id)), sql`${backupCalls.id} not in (${offered})`,
      ));
      const profile = await profileOf(v.id);
      return { open: rows.length, forMe: rows.filter((r) => matches(r, profile)).length };
    },

    async create(v: Volunteer, input: BackupInput): Promise<BackupCall> {
      if (input.neededOn < today()) throw new BackupError("CONFLICT", "past_date");
      const [r] = await db.insert(backupCalls).values({
        title: input.title, details: input.details, neededOn: input.neededOn, startsAt: input.startsAt, place: input.place,
        languages: input.languages, skills: input.skills, needed: input.needed, openToAll: input.openToAll,
        associationId: v.association?.id ?? null, authorId: v.id, createdAt: deps.now(),
      }).returning();
      return (await toCalls([r!], v))[0]!;
    },

    async offer(v: Volunteer, id: string, note: string | undefined): Promise<BackupCall> {
      const r = await mustVisible(id, v);
      if (!stillOpen(r)) throw new BackupError("CONFLICT", "not_open");
      if (r.authorId === v.id) throw new BackupError("CONFLICT", "own_call");
      const values = { callId: id, volunteerId: v.id, note: note?.trim() || null, createdAt: deps.now() };
      await db.insert(backupOffers).values(values).onConflictDoUpdate({ target: [backupOffers.callId, backupOffers.volunteerId], set: { note: values.note } });
      return one(id, v);
    },

    async withdraw(v: Volunteer, id: string): Promise<BackupCall> {
      await mustVisible(id, v);
      await db.delete(backupOffers).where(and(eq(backupOffers.callId, id), eq(backupOffers.volunteerId, v.id)));
      return one(id, v);
    },

    async close(v: Volunteer, id: string, status: "covered" | "cancelled"): Promise<BackupCall> {
      const r = await mustVisible(id, v);
      if (!canClose(v, r)) throw new BackupError("FORBIDDEN");
      if (r.status !== "open") throw new BackupError("CONFLICT", "not_open");
      await db.update(backupCalls).set({ status, closedAt: deps.now(), closedBy: v.id }).where(eq(backupCalls.id, id));
      return one(id, v);
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
const cache = new WeakMap<object, BackupService>();
export function getBackup(deps: BackupDeps): BackupService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createBackupService(deps)));
  return s;
}
