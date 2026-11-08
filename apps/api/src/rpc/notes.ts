import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { CaseNote, CaseTask, LanguageCode, Permission, TaskStatus, Volunteer } from "@wilson/contracts";
import { permissionsOf } from "../auth/service.js";
import { maskedLabel } from "../beneficiaries/serviceImpl.js";
import { beneficiaries, caseNotes, caseTasks, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { getServices } from "../services.js";
import { localDate } from "../time.js";
import { logAccess } from "./logAccess.js";
import { can, os, requirePermission } from "./base.js";

type NoteRow = typeof caseNotes.$inferSelect;
type TaskRow = typeof caseTasks.$inferSelect;

const view = requirePermission("notes.view");
const write = requirePermission("notes.write");

const today = (deps: Deps) => localDate(deps.now(), deps.config.TIMEZONE);

async function names(deps: Deps, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}
const ref = (m: Map<string, string>, id: string | null) => (id && m.has(id) ? { id, name: m.get(id)! } : null);

async function beneficiaryOr404(deps: Deps, id: string) {
  const [b] = await deps.db.select({ id: beneficiaries.id, language: beneficiaries.language, last2: beneficiaries.waIdLast2, handle: beneficiaries.webHandle, wrapped: beneficiaries.wrappedDek })
    .from(beneficiaries).where(and(eq(beneficiaries.id, id), isNull(beneficiaries.archivedAt)));
  if (!b || !b.wrapped) throw new ORPCError("NOT_FOUND");
  return b;
}

const dek = (deps: Deps, beneficiaryId: string) => getServices(deps).beneficiaries.getDek(beneficiaryId);
const seal = async (deps: Deps, beneficiaryId: string, text: string) => deps.crypto.encrypt(await dek(deps, beneficiaryId), text);
const open = async (deps: Deps, beneficiaryId: string, enc: Buffer) => deps.crypto.decrypt(await dek(deps, beneficiaryId), enc).toString("utf8");

async function toNotes(deps: Deps, me: Volunteer, rows: NoteRow[]): Promise<CaseNote[]> {
  const n = await names(deps, rows.map((r) => r.authorId));
  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    beneficiaryId: r.beneficiaryId,
    text: await open(deps, r.beneficiaryId, r.bodyEnc),
    author: ref(n, r.authorId),
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    canEdit: r.authorId === me.id || can(me, "notes.moderate"),
  })));
}

async function toTasks(deps: Deps, me: Volunteer, rows: TaskRow[]): Promise<CaseTask[]> {
  if (!rows.length) return [];
  const n = await names(deps, rows.flatMap((r) => [r.assigneeId, r.createdBy, r.doneBy]));
  const bs = await deps.db.select({ id: beneficiaries.id, language: beneficiaries.language, last2: beneficiaries.waIdLast2, handle: beneficiaries.webHandle, avatar: beneficiaries.avatar })
    .from(beneficiaries).where(inArray(beneficiaries.id, [...new Set(rows.map((r) => r.beneficiaryId))]));
  const b = new Map(bs.map((x) => [x.id, x]));
  const day = today(deps);
  return Promise.all(rows.map(async (r) => ({
    id: r.id,
    beneficiaryId: r.beneficiaryId,
    beneficiaryLabel: maskedLabel(b.get(r.beneficiaryId)?.last2 ?? "••", b.get(r.beneficiaryId)?.handle, b.get(r.beneficiaryId)?.avatar),
    language: (b.get(r.beneficiaryId)?.language ?? "fr") as LanguageCode,
    text: await open(deps, r.beneficiaryId, r.textEnc),
    dueOn: r.dueOn,
    status: r.status as TaskStatus,
    assignee: ref(n, r.assigneeId),
    createdBy: ref(n, r.createdBy),
    createdAt: r.createdAt.toISOString(),
    doneAt: r.doneAt?.toISOString() ?? null,
    doneBy: ref(n, r.doneBy),
    due: r.status === "open" && r.dueOn !== null && r.dueOn <= day,
    canEdit: r.createdBy === me.id || can(me, "notes.moderate"),
  })));
}

/**
 * Who may hold a task: yourself or nobody with notes.write; someone else needs tasks.assign, and that person must be
 * an active account able to read notes, otherwise they would get a reminder they cannot open.
 */
async function checkAssignee(deps: Deps, me: Volunteer, assigneeId: string | null) {
  if (assigneeId === null || assigneeId === me.id) return;
  if (!can(me, "tasks.assign")) throw new ORPCError("FORBIDDEN");
  const perms = (await permissionsOf(deps.db, [assigneeId])).get(assigneeId);
  if (!perms) throw new ORPCError("NOT_FOUND");
  if (!perms.includes("notes.view")) throw new ORPCError("CONFLICT", { data: { reason: "assignee_cannot_view" } });
}

async function noteOr404(deps: Deps, id: string) {
  const [r] = await deps.db.select().from(caseNotes).where(eq(caseNotes.id, id));
  if (!r) throw new ORPCError("NOT_FOUND");
  return r;
}
async function taskOr404(deps: Deps, id: string) {
  const [r] = await deps.db.select().from(caseTasks).where(eq(caseTasks.id, id));
  if (!r) throw new ORPCError("NOT_FOUND");
  await beneficiaryOr404(deps, r.beneficiaryId);
  return r;
}

const openFirst = sql`case when ${caseTasks.status} = 'open' then 0 else 1 end`;

export const notesRouter = {
  list: os.notes.list.use(view).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    await beneficiaryOr404(deps, input.beneficiaryId);
    const notes = await deps.db.select().from(caseNotes).where(eq(caseNotes.beneficiaryId, input.beneficiaryId)).orderBy(desc(caseNotes.createdAt)).limit(200);
    const open = await deps.db.select().from(caseTasks)
      .where(and(eq(caseTasks.beneficiaryId, input.beneficiaryId), eq(caseTasks.status, "open")))
      .orderBy(sql`${caseTasks.dueOn} asc nulls last`, asc(caseTasks.createdAt));
    const closed = await deps.db.select().from(caseTasks)
      .where(and(eq(caseTasks.beneficiaryId, input.beneficiaryId), ne(caseTasks.status, "open")))
      .orderBy(desc(caseTasks.doneAt)).limit(20);
    await logAccess(context, "notes.view", input.beneficiaryId);
    return { notes: await toNotes(deps, me, notes), tasks: await toTasks(deps, me, [...open, ...closed]) };
  }),

  add: os.notes.add.use(write).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    await beneficiaryOr404(deps, input.beneficiaryId);
    const [r] = await deps.db.insert(caseNotes).values({
      beneficiaryId: input.beneficiaryId, authorId: me.id, bodyEnc: await seal(deps, input.beneficiaryId, input.text), createdAt: deps.now(),
    }).returning();
    await logAccess(context, "notes.add", r!.id);
    return (await toNotes(deps, me, [r!]))[0]!;
  }),

  edit: os.notes.edit.use(write).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    const r = await noteOr404(deps, input.id);
    await beneficiaryOr404(deps, r.beneficiaryId);
    const own = r.authorId === me.id;
    if (!own && !can(me, "notes.moderate")) throw new ORPCError("FORBIDDEN");
    const [u] = await deps.db.update(caseNotes).set({ bodyEnc: await seal(deps, r.beneficiaryId, input.text), editedAt: deps.now() })
      .where(eq(caseNotes.id, r.id)).returning();
    await logAccess(context, own ? "notes.edit" : "notes.edit_moderated", r.id);
    return (await toNotes(deps, me, [u!]))[0]!;
  }),

  remove: os.notes.remove.use(write).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    const r = await noteOr404(deps, input.id);
    const own = r.authorId === me.id;
    if (!own && !can(me, "notes.moderate")) throw new ORPCError("FORBIDDEN");
    await deps.db.delete(caseNotes).where(eq(caseNotes.id, r.id));
    await logAccess(context, own ? "notes.remove" : "notes.remove_moderated", r.id);
  }),
};

export const tasksRouter = {
  list: os.tasks.list.use(view).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    const who =
      input.filter === "mine" ? eq(caseTasks.assigneeId, me.id)
      : input.filter === "unassigned" ? isNull(caseTasks.assigneeId)
      : and(eq(caseTasks.createdBy, me.id), ne(caseTasks.assigneeId, me.id));
    const rows = await deps.db.select({ t: caseTasks }).from(caseTasks)
      .innerJoin(beneficiaries, eq(beneficiaries.id, caseTasks.beneficiaryId))
      .where(and(who, isNull(beneficiaries.archivedAt), input.includeClosed ? undefined : eq(caseTasks.status, "open")))
      .orderBy(openFirst, sql`${caseTasks.dueOn} asc nulls last`, desc(caseTasks.createdAt))
      .limit(100);
    await logAccess(context, `tasks.list:${input.filter}`, null);
    return toTasks(deps, me, rows.map((r) => r.t));
  }),

  dueCount: os.tasks.dueCount.use(view).handler(async ({ context }) => {
    const { deps, volunteer: me } = context;
    const [r] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(caseTasks)
      .innerJoin(beneficiaries, eq(beneficiaries.id, caseTasks.beneficiaryId))
      .where(and(eq(caseTasks.assigneeId, me.id), eq(caseTasks.status, "open"), lte(caseTasks.dueOn, today(deps)), isNull(beneficiaries.archivedAt)));
    return { count: r?.n ?? 0 };
  }),

  add: os.tasks.add.use(write).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    await beneficiaryOr404(deps, input.beneficiaryId);
    await checkAssignee(deps, me, input.assigneeId);
    const [r] = await deps.db.insert(caseTasks).values({
      beneficiaryId: input.beneficiaryId, createdBy: me.id, assigneeId: input.assigneeId, dueOn: input.dueOn,
      textEnc: await seal(deps, input.beneficiaryId, input.text), createdAt: deps.now(),
    }).returning();
    await logAccess(context, input.assigneeId && input.assigneeId !== me.id ? "tasks.add_assigned" : "tasks.add", r!.id);
    return (await toTasks(deps, me, [r!]))[0]!;
  }),

  update: os.tasks.update.use(write).handler(async ({ input, context }) => {
    const { deps, volunteer: me } = context;
    const r = await taskOr404(deps, input.id);
    const patch: Partial<typeof caseTasks.$inferInsert> = {};
    if (input.text !== undefined) {
      if (r.createdBy !== me.id && !can(me, "notes.moderate")) throw new ORPCError("FORBIDDEN");
      patch.textEnc = await seal(deps, r.beneficiaryId, input.text);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== r.assigneeId) {
      // Handing your own task back to "anyone" is fine; taking someone else's task needs tasks.assign too.
      const takingFromOther = r.assigneeId !== null && r.assigneeId !== me.id;
      if (takingFromOther && !can(me, "tasks.assign")) throw new ORPCError("FORBIDDEN");
      await checkAssignee(deps, me, input.assigneeId);
      patch.assigneeId = input.assigneeId;
    }
    if (input.dueOn !== undefined) patch.dueOn = input.dueOn;
    if (input.status !== undefined && input.status !== r.status) {
      patch.status = input.status;
      patch.doneAt = input.status === "open" ? null : deps.now();
      patch.doneBy = input.status === "open" ? null : me.id;
    }
    const [u] = Object.keys(patch).length
      ? await deps.db.update(caseTasks).set(patch).where(eq(caseTasks.id, r.id)).returning()
      : [r];
    const what = [input.text !== undefined && "text", patch.assigneeId !== undefined && "assignee", input.dueOn !== undefined && "due", patch.status && `status=${patch.status}`].filter(Boolean).join(",");
    await logAccess(context, `tasks.update:${what || "none"}`, r.id);
    return (await toTasks(deps, me, [u!]))[0]!;
  }),
};
