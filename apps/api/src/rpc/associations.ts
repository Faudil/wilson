import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Association, Invitation } from "@wilson/contracts";
import { INVITATION_TTL_DAYS, sha256Hex } from "../auth/service.js";
import { associations, invitations, sessions, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission } from "./base.js";
import { mustRow, one, scopeOf } from "./volunteers.js";

type ARow = typeof associations.$inferSelect;
type IRow = typeof invitations.$inferSelect;
const globalAdmin = requirePermission("associations.manage");

async function toAssociations(deps: Deps, rows: ARow[]): Promise<Association[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const members = await deps.db
    .select({ id: volunteers.id, name: volunteers.name, associationId: volunteers.associationId, admin: volunteers.associationAdmin, pending: volunteers.pendingApproval, disabledAt: volunteers.disabledAt })
    .from(volunteers).where(inArray(volunteers.associationId, ids));
  return rows.map((r) => {
    const mine = members.filter((m) => m.associationId === r.id);
    return {
      id: r.id, name: r.name, siren: r.siren, rna: r.rna, city: r.city,
      memberCount: mine.filter((m) => !m.pending && !m.disabledAt).length,
      pendingCount: mine.filter((m) => m.pending).length,
      admins: mine.filter((m) => m.admin && !m.pending).map((m) => ({ id: m.id, name: m.name })).sort((a, z) => a.name.localeCompare(z.name, "fr")),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function mustAssociation(deps: Deps, id: string): Promise<ARow> {
  const [a] = await deps.db.select().from(associations).where(eq(associations.id, id)).limit(1);
  if (!a) throw new ORPCError("NOT_FOUND");
  return a;
}

/** Sessions are dropped when someone's rights shrink, so the change cannot wait for a cached tab. */
async function dropSessions(deps: Deps, volunteerId: string) {
  await deps.db.delete(sessions).where(eq(sessions.volunteerId, volunteerId));
}

export const associationsRouter = {
  list: os.associations.list.use(globalAdmin).handler(async ({ context }) => {
    const rows = await context.deps.db.select().from(associations);
    return (await toAssociations(context.deps, rows)).sort((a, z) => a.name.localeCompare(z.name, "fr"));
  }),

  create: os.associations.create.use(globalAdmin).handler(async ({ input, context }) => {
    const { db } = context.deps;
    for (const [col, v] of [[associations.siren, input.siren], [associations.rna, input.rna]] as const) {
      if (v && (await db.select({ id: associations.id }).from(associations).where(eq(col, v)).limit(1)).length) {
        throw new ORPCError("CONFLICT", { data: { reason: "exists" } });
      }
    }
    const [row] = await db.insert(associations).values({ name: input.name.trim(), siren: input.siren, rna: input.rna, city: input.city, createdBy: context.volunteer.id }).returning();
    // Pending requests that named this association in the register now go to its admins.
    const claims = [input.siren && eq(volunteers.associationSiren, input.siren), input.rna && eq(volunteers.associationRna, input.rna)].filter((c) => !!c);
    if (claims.length) {
      await db.update(volunteers).set({ associationId: row!.id })
        .where(and(eq(volunteers.pendingApproval, true), isNull(volunteers.associationId), sql`(${sql.join(claims as never[], sql` or `)})`));
    }
    await logAccess(context, "associations.create", row!.id);
    return (await toAssociations(context.deps, [row!]))[0]!;
  }),

  setMember: os.associations.setMember.use(globalAdmin).handler(async ({ input, context }) => {
    const r = await mustRow(context.deps, input.volunteerId);
    if (input.associationId) await mustAssociation(context.deps, input.associationId);
    const leaving = r.associationId !== input.associationId;
    await context.deps.db.update(volunteers)
      .set({ associationId: input.associationId, ...(leaving ? { associationAdmin: false } : {}) })
      .where(eq(volunteers.id, input.volunteerId));
    if (leaving && r.associationAdmin) await dropSessions(context.deps, r.id);
    await logAccess(context, `associations.set_member:${input.associationId ?? "none"}`, input.volunteerId);
    return one(context.deps, input.volunteerId);
  }),

  setAdmin: os.associations.setAdmin.use(globalAdmin).handler(async ({ input, context }) => {
    const r = await mustRow(context.deps, input.volunteerId);
    await mustAssociation(context.deps, input.associationId);
    if (r.pendingApproval || r.disabledAt) throw new ORPCError("CONFLICT", { data: { reason: "not_active" } });
    if (input.admin) {
      await context.deps.db.update(volunteers).set({ associationId: input.associationId, associationAdmin: true }).where(eq(volunteers.id, r.id));
    } else {
      if (r.associationId !== input.associationId) throw new ORPCError("NOT_FOUND");
      await context.deps.db.update(volunteers).set({ associationAdmin: false }).where(eq(volunteers.id, r.id));
      await dropSessions(context.deps, r.id);
    }
    await logAccess(context, `associations.${input.admin ? "add_admin" : "remove_admin"}:${input.associationId}`, r.id);
    return one(context.deps, r.id);
  }),
};

/* ---------- invitations ---------- */

const inviter = os.middleware(async ({ context, next }) => {
  const v = context.volunteer;
  if (!v) throw new ORPCError("UNAUTHORIZED");
  if (!v.permissions.includes("volunteers.manage") && !(v.permissions.includes("members.manage") && v.association)) throw new ORPCError("FORBIDDEN");
  return next({ context: { volunteer: v } });
});

async function toInvitations(deps: Deps, rows: IRow[]): Promise<Invitation[]> {
  const vIds = [...new Set(rows.flatMap((r) => [r.createdBy, ...(r.usedBy ? [r.usedBy] : [])]))];
  const aIds = [...new Set(rows.flatMap((r) => (r.associationId ? [r.associationId] : [])))];
  const vNames = new Map((vIds.length ? await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, vIds)) : []).map((v) => [v.id, v.name]));
  const aNames = new Map((aIds.length ? await deps.db.select({ id: associations.id, name: associations.name }).from(associations).where(inArray(associations.id, aIds)) : []).map((a) => [a.id, a.name]));
  const now = deps.now();
  return rows.map((r) => ({
    id: r.id,
    association: r.associationId ? { id: r.associationId, name: aNames.get(r.associationId) ?? "?" } : null,
    role: r.role as Invitation["role"],
    label: r.label,
    createdByName: vNames.get(r.createdBy) ?? null,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    status: r.usedAt ? "used" : r.revokedAt ? "revoked" : r.expiresAt <= now ? "expired" : "open",
    usedByName: r.usedBy ? (vNames.get(r.usedBy) ?? null) : null,
  }));
}

export const invitationsRouter = {
  list: os.invitations.list.use(inviter).handler(async ({ context }) => {
    const scope = scopeOf(context);
    const rows = await context.deps.db.select().from(invitations)
      .where(scope !== null ? eq(invitations.associationId, scope) : undefined)
      .orderBy(desc(invitations.createdAt)).limit(50);
    return toInvitations(context.deps, rows);
  }),

  create: os.invitations.create.use(inviter).handler(async ({ input, context }) => {
    const scope = scopeOf(context);
    let associationId: string | null;
    if (scope !== null) {
      if (input.role === "admin") throw new ORPCError("FORBIDDEN");
      associationId = scope;
    } else {
      associationId = input.associationId ?? null;
      if (associationId) await mustAssociation(context.deps, associationId);
    }
    const token = randomBytes(24).toString("base64url");
    const now = context.deps.now();
    const [row] = await context.deps.db.insert(invitations).values({
      tokenHash: sha256Hex(token), associationId, role: input.role, label: input.label?.trim() || null,
      createdBy: context.volunteer.id, expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000),
    }).returning();
    await logAccess(context, `invitations.create:${input.role}`, row!.id);
    return { invitation: (await toInvitations(context.deps, [row!]))[0]!, token };
  }),

  revoke: os.invitations.revoke.use(inviter).handler(async ({ input, context }) => {
    const [row] = await context.deps.db.select().from(invitations).where(eq(invitations.id, input.id)).limit(1);
    const scope = scopeOf(context);
    if (!row || (scope !== null && row.associationId !== scope)) throw new ORPCError("NOT_FOUND");
    if (row.usedAt) throw new ORPCError("CONFLICT", { data: { reason: "used" } });
    const [updated] = await context.deps.db.update(invitations).set({ revokedAt: row.revokedAt ?? context.deps.now() }).where(eq(invitations.id, row.id)).returning();
    await logAccess(context, "invitations.revoke", row.id);
    return (await toInvitations(context.deps, [updated!]))[0]!;
  }),
};
