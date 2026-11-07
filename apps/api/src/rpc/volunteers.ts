import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { VolunteerAccount, VolunteerAccountStatus } from "@wilson/contracts";
import { beneficiaries, sessions, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission, type RpcContext } from "./base.js";

type Row = typeof volunteers.$inferSelect;
const manage = requirePermission("volunteers.manage");

const statusOf = (r: Row): VolunteerAccountStatus => (r.pendingApproval ? "pending" : r.disabledAt ? "disabled" : "active");

async function toAccounts(deps: Deps, rows: Row[]): Promise<VolunteerAccount[]> {
  const approverIds = [...new Set(rows.flatMap((r) => (r.approvedBy ? [r.approvedBy] : [])))];
  const names = new Map<string, string>();
  if (approverIds.length) {
    for (const a of await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, approverIds))) names.set(a.id, a.name);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role as VolunteerAccount["role"],
    status: statusOf(r),
    uiLanguage: r.uiLanguage,
    note: r.signupNote,
    association: r.associationName
      ? { name: r.associationName, siren: r.associationSiren, rna: r.associationRna, city: r.associationCity }
      : null,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? null) : null,
  }));
}

async function mustRow(deps: Deps, id: string): Promise<Row> {
  const [r] = await deps.db.select().from(volunteers).where(eq(volunteers.id, id)).limit(1);
  if (!r) throw new ORPCError("NOT_FOUND");
  return r;
}

/** Admins cannot lock themselves out (disable or demote their own account). */
function notSelf(ctx: RpcContext, id: string) {
  if (ctx.volunteer?.id === id) throw new ORPCError("CONFLICT", { data: { reason: "self" } });
}

async function one(deps: Deps, id: string): Promise<VolunteerAccount> {
  return (await toAccounts(deps, [await mustRow(deps, id)]))[0]!;
}

/** Revoke every session of an account and release the conversations it held (back to "needs a person"). */
async function revoke(deps: Deps, id: string) {
  await deps.db.delete(sessions).where(eq(sessions.volunteerId, id));
  await deps.db.update(beneficiaries).set({ chatAssigneeId: null, chatStatus: "needs_human" }).where(eq(beneficiaries.chatAssigneeId, id));
}

export const volunteersRouter = {
  list: os.volunteers.list.use(manage).handler(async ({ input, context }) => {
    const { db } = context.deps;
    const where =
      input.status === "pending" ? eq(volunteers.pendingApproval, true)
      : input.status === "active" ? and(eq(volunteers.pendingApproval, false), isNull(volunteers.disabledAt))
      : input.status === "disabled" ? and(eq(volunteers.pendingApproval, false), isNotNull(volunteers.disabledAt))
      : undefined;
    const rows = await db.select().from(volunteers).where(where).orderBy(asc(volunteers.createdAt));
    // Pending requests first (oldest first), then everyone else by name.
    const order = { pending: 0, active: 1, disabled: 2 } as const;
    const accounts = await toAccounts(context.deps, rows);
    return accounts.sort((a, z) => order[a.status] - order[z.status] || (a.status === "pending" ? 0 : a.name.localeCompare(z.name, "fr")));
  }),

  approve: os.volunteers.approve.use(manage).handler(async ({ input, context }) => {
    const r = await mustRow(context.deps, input.id);
    if (!r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "not_pending" } });
    await context.deps.db.update(volunteers)
      .set({ pendingApproval: false, role: input.role, approvedAt: context.deps.now(), approvedBy: context.volunteer.id })
      .where(eq(volunteers.id, input.id));
    await logAccess(context, `volunteers.approve:${input.role}`, input.id);
    return one(context.deps, input.id);
  }),

  reject: os.volunteers.reject.use(manage).handler(async ({ input, context }) => {
    const r = await mustRow(context.deps, input.id);
    if (!r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "not_pending" } });
    // A refused request is deleted outright: nothing to keep about someone who never had access.
    await context.deps.db.delete(volunteers).where(and(eq(volunteers.id, input.id), eq(volunteers.pendingApproval, true)));
    await logAccess(context, "volunteers.reject", null);
  }),

  setRole: os.volunteers.setRole.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    const r = await mustRow(context.deps, input.id);
    if (r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "pending" } });
    await context.deps.db.update(volunteers).set({ role: input.role }).where(eq(volunteers.id, input.id));
    // Permissions are resolved per request from the role, so the change applies on the person's next click.
    await logAccess(context, `volunteers.set_role:${input.role}`, input.id);
    return one(context.deps, input.id);
  }),

  setDisabled: os.volunteers.setDisabled.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    const r = await mustRow(context.deps, input.id);
    if (r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "pending" } });
    await context.deps.db.update(volunteers).set({ disabledAt: input.disabled ? context.deps.now() : null }).where(eq(volunteers.id, input.id));
    if (input.disabled) await revoke(context.deps, input.id);
    await logAccess(context, input.disabled ? "volunteers.disable" : "volunteers.enable", input.id);
    return one(context.deps, input.id);
  }),
};
