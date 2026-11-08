import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { GLOBAL_ONLY_PERMISSIONS, type Permission, type VolunteerAccount, type VolunteerAccountStatus, type VolunteerRole } from "@wilson/contracts";
import { effectivePermissions } from "../auth/service.js";
import { associations, beneficiaries, sessions, volunteerPermissions, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { alert } from "../alerts.js";
import { getBuddies } from "../buddies/service.js";
import { getWaDeps } from "../whatsapp/context.js";
import { logAccess } from "./logAccess.js";
import { os, type RpcContext } from "./base.js";

type Row = typeof volunteers.$inferSelect;
/** Global admins (volunteers.manage) or association admins (members.manage); the scope is checked per account. */
const manage = os.middleware(async ({ context, next }) => {
  const v = context.volunteer;
  if (!v) throw new ORPCError("UNAUTHORIZED");
  if (!v.permissions.includes("volunteers.manage") && !(v.permissions.includes("members.manage") && v.association)) throw new ORPCError("FORBIDDEN");
  return next({ context: { volunteer: v } });
});

/** null = every account (global admin); else the only association whose members the caller may manage. */
export function scopeOf(ctx: RpcContext): string | null {
  const v = ctx.volunteer!;
  if (v.permissions.includes("volunteers.manage")) return null;
  return v.association!.id;
}

/** The account if the caller may manage it; NOT_FOUND otherwise (an association admin cannot even see others). */
async function inScope(ctx: RpcContext, id: string): Promise<Row> {
  const r = await mustRow(ctx.deps, id);
  const scope = scopeOf(ctx);
  if (scope !== null) {
    if (r.associationId !== scope) throw new ORPCError("NOT_FOUND");
    // Fellow association admins and admin-role accounts are managed by global admins only.
    if (r.id !== ctx.volunteer!.id && (r.associationAdmin || r.role === "admin")) throw new ORPCError("FORBIDDEN");
  }
  return r;
}

/** Association admins hand out at most the volunteer role. */
function checkRole(ctx: RpcContext, role: VolunteerRole) {
  if (scopeOf(ctx) !== null && role === "admin") throw new ORPCError("FORBIDDEN");
}

const statusOf = (r: Row): VolunteerAccountStatus => (r.pendingApproval ? "pending" : r.disabledAt ? "disabled" : "active");

export async function toAccounts(deps: Deps, rows: Row[]): Promise<VolunteerAccount[]> {
  const approverIds = [...new Set(rows.flatMap((r) => (r.approvedBy ? [r.approvedBy] : [])))];
  const names = new Map<string, string>();
  if (approverIds.length) {
    for (const a of await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, approverIds))) names.set(a.id, a.name);
  }
  const assocIds = [...new Set(rows.flatMap((r) => (r.associationId ? [r.associationId] : [])))];
  const assocNames = new Map<string, string>();
  if (assocIds.length) {
    for (const a of await deps.db.select({ id: associations.id, name: associations.name }).from(associations).where(inArray(associations.id, assocIds))) assocNames.set(a.id, a.name);
  }
  const overrides = new Map<string, { permission: Permission; granted: boolean }[]>();
  if (rows.length) {
    for (const o of await deps.db.select().from(volunteerPermissions).where(inArray(volunteerPermissions.volunteerId, rows.map((r) => r.id)))) {
      overrides.set(o.volunteerId, [...(overrides.get(o.volunteerId) ?? []), { permission: o.permission as Permission, granted: o.granted }]);
    }
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
    memberOf: r.associationId ? { id: r.associationId, name: assocNames.get(r.associationId) ?? "?" } : null,
    associationAdmin: !!r.associationId && r.associationAdmin,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    approvedByName: r.approvedBy ? (names.get(r.approvedBy) ?? null) : null,
    emailVerified: r.emailVerified,
    twoFactorEnabled: !!r.totpEnabledAt,
    // A pending account has no access at all, whatever its role says.
    permissions: r.pendingApproval ? [] : effectivePermissions(r.role as VolunteerRole, overrides.get(r.id) ?? [], r).sort(),
    overrides: (overrides.get(r.id) ?? []).sort((a, z) => a.permission.localeCompare(z.permission)),
  }));
}

export async function mustRow(deps: Deps, id: string): Promise<Row> {
  const [r] = await deps.db.select().from(volunteers).where(eq(volunteers.id, id)).limit(1);
  if (!r) throw new ORPCError("NOT_FOUND");
  return r;
}

/** Admins cannot lock themselves out (disable or demote their own account). */
function notSelf(ctx: RpcContext, id: string) {
  if (ctx.volunteer?.id === id) throw new ORPCError("CONFLICT", { data: { reason: "self" } });
}

export async function one(deps: Deps, id: string): Promise<VolunteerAccount> {
  return (await toAccounts(deps, [await mustRow(deps, id)]))[0]!;
}

/**
 * Revoke every session of an account, release the conversations it held (back to "needs a person") and end its
 * French practice pairings (the beneficiaries are told and can ask for a new buddy).
 */
export async function revoke(deps: Deps, id: string) {
  await deps.db.delete(sessions).where(eq(sessions.volunteerId, id));
  await deps.db.update(beneficiaries).set({ chatAssigneeId: null, chatStatus: "needs_human" }).where(eq(beneficiaries.chatAssigneeId, id));
  await getBuddies(getWaDeps()).endAllForVolunteer(id);
}

export const volunteersRouter = {
  list: os.volunteers.list.use(manage).handler(async ({ input, context }) => {
    const { db } = context.deps;
    const where =
      input.status === "pending" ? eq(volunteers.pendingApproval, true)
      : input.status === "active" ? and(eq(volunteers.pendingApproval, false), isNull(volunteers.disabledAt))
      : input.status === "disabled" ? and(eq(volunteers.pendingApproval, false), isNotNull(volunteers.disabledAt))
      : undefined;
    const scope = scopeOf(context);
    const conds = [where, scope !== null ? eq(volunteers.associationId, scope) : undefined].filter((c): c is SQL => !!c);
    const rows = await db.select().from(volunteers).where(conds.length ? and(...conds) : undefined).orderBy(asc(volunteers.createdAt));
    // Pending requests first (oldest first), then everyone else by name.
    const order = { pending: 0, active: 1, disabled: 2 } as const;
    const accounts = await toAccounts(context.deps, rows);
    return accounts.sort((a, z) => order[a.status] - order[z.status] || (a.status === "pending" ? 0 : a.name.localeCompare(z.name, "fr")));
  }),

  approve: os.volunteers.approve.use(manage).handler(async ({ input, context }) => {
    checkRole(context, input.role);
    const r = await inScope(context, input.id);
    if (!r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "not_pending" } });
    // With e-mail set up, the person must first prove they own the address.
    if (!r.emailVerified) throw new ORPCError("CONFLICT", { data: { reason: "email_unverified" } });
    await context.deps.db.update(volunteers)
      .set({ pendingApproval: false, role: input.role, approvedAt: context.deps.now(), approvedBy: context.volunteer.id })
      .where(eq(volunteers.id, input.id));
    await logAccess(context, `volunteers.approve:${input.role}`, input.id);
    if (input.role === "admin") void alert(context.deps, `volunteers.admin:${input.id}`, `${context.volunteer.name} approved a new account as admin.`);
    return one(context.deps, input.id);
  }),

  reject: os.volunteers.reject.use(manage).handler(async ({ input, context }) => {
    const r = await inScope(context, input.id);
    if (!r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "not_pending" } });
    // A refused request is deleted outright: nothing to keep about someone who never had access.
    await context.deps.db.delete(volunteers).where(and(eq(volunteers.id, input.id), eq(volunteers.pendingApproval, true)));
    await logAccess(context, "volunteers.reject", null);
  }),

  setRole: os.volunteers.setRole.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    checkRole(context, input.role);
    const r = await inScope(context, input.id);
    if (r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "pending" } });
    await context.deps.db.update(volunteers).set({ role: input.role }).where(eq(volunteers.id, input.id));
    // Permissions are resolved per request from the role, so the change applies on the person's next click.
    await logAccess(context, `volunteers.set_role:${input.role}`, input.id);
    if (input.role === "admin") void alert(context.deps, `volunteers.admin:${input.id}`, `${context.volunteer.name} gave admin rights to ${r.name}.`);
    return one(context.deps, input.id);
  }),

  setDisabled: os.volunteers.setDisabled.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    const r = await inScope(context, input.id);
    if (r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "pending" } });
    await context.deps.db.update(volunteers).set({ disabledAt: input.disabled ? context.deps.now() : null }).where(eq(volunteers.id, input.id));
    if (input.disabled) await revoke(context.deps, input.id);
    await logAccess(context, input.disabled ? "volunteers.disable" : "volunteers.enable", input.id);
    return one(context.deps, input.id);
  }),

  resetTwoFactor: os.volunteers.resetTwoFactor.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    const r = await mustRow(context.deps, input.id);
    await context.deps.db.update(volunteers).set({ totpEnabledAt: null, totpSecretEnc: null, totpWrappedDek: null, totpLastStep: null }).where(eq(volunteers.id, r.id));
    // Whoever holds the old sessions keeps nothing: they log in again (and enrol again if they are an admin).
    await context.deps.db.delete(sessions).where(eq(sessions.volunteerId, r.id));
    await logAccess(context, "volunteers.reset_2fa", r.id);
    void alert(context.deps, `volunteers.reset_2fa:${r.id}`, `${context.volunteer.name} removed the authenticator app of ${r.name}.`);
    return one(context.deps, r.id);
  }),

  setPermissions: os.volunteers.setPermissions.use(manage).handler(async ({ input, context }) => {
    notSelf(context, input.id);
    const r = await inScope(context, input.id);
    if (r.pendingApproval) throw new ORPCError("CONFLICT", { data: { reason: "pending" } });
    // One entry per permission (the last one wins), and none that only repeats what the role already gives.
    const bundle = new Set(effectivePermissions(r.role as VolunteerRole, [], r));
    const wanted = new Map(input.overrides.map((o) => [o.permission, o.granted]));
    if (scopeOf(context) !== null) {
      // Association admin: cannot touch global-only rights (kept as a global admin set them) nor grant what they lack.
      const current = await context.deps.db.select().from(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, input.id));
      const now = new Set(effectivePermissions(r.role as VolunteerRole, current as { permission: Permission; granted: boolean }[], r));
      for (const p of GLOBAL_ONLY_PERMISSIONS) {
        if (wanted.has(p) && wanted.get(p) !== now.has(p)) throw new ORPCError("FORBIDDEN");
        wanted.set(p, now.has(p));
      }
      for (const [p, granted] of wanted) if (granted && !now.has(p) && !context.volunteer.permissions.includes(p)) throw new ORPCError("FORBIDDEN");
    }
    const rows = [...wanted].filter(([p, granted]) => granted !== bundle.has(p)).map(([permission, granted]) => ({ volunteerId: input.id, permission, granted }));
    await context.deps.db.transaction(async (tx) => {
      await tx.delete(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, input.id));
      if (rows.length) await tx.insert(volunteerPermissions).values(rows);
    });
    // Resolved per request (auth.resolveVolunteer), so it applies on the person's next click. One log line per change.
    await logAccess(context, `volunteers.set_permissions:${rows.map((o) => `${o.granted ? "+" : "-"}${o.permission}`).join(",") || "role_default"}`, input.id);
    return one(context.deps, input.id);
  }),
};
