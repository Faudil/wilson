import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Permission, Volunteer } from "@wilson/contracts";
import { permissionsOf } from "../auth/service.js";
import type { Db } from "../db/client.js";
import { associations, volunteers } from "../db/schema.js";

/**
 * Who sees what on the team side (news, calls for backup). Global admins (volunteers.manage) see every association;
 * everyone else sees what is for everyone and what is for their own association.
 */
export const isGlobalAdmin = (v: Volunteer): boolean => v.permissions.includes("volunteers.manage");

/** Same association, a missing association counting as its own group ("no association"). */
export const sameAssociation = (v: Volunteer, associationId: string | null): boolean => (v.association?.id ?? null) === associationId;

/** Names of associations by id (for the labels on posts and calls). */
export async function associationNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const m = new Map<string, string>();
  if (unique.length) for (const a of await db.select({ id: associations.id, name: associations.name }).from(associations).where(inArray(associations.id, unique))) m.set(a.id, a.name);
  return m;
}

export async function volunteerNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const m = new Map<string, string>();
  if (unique.length) for (const v of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, unique))) m.set(v.id, v.name);
  return m;
}

/**
 * Active accounts holding `permission`, in one association (or every account when `associationId` is null and
 * `everyone` is set). Effective permissions, so a revoked right is respected.
 */
export async function activeHolders(db: Db, permission: Permission, scope: { associationId: string | null; everyone: boolean }): Promise<{ id: string; email: string; uiLanguage: string }[]> {
  const where = [isNull(volunteers.disabledAt), eq(volunteers.pendingApproval, false)];
  if (!scope.everyone) where.push(scope.associationId ? eq(volunteers.associationId, scope.associationId) : isNull(volunteers.associationId));
  const rows = await db.select({ id: volunteers.id, email: volunteers.email, uiLanguage: volunteers.uiLanguage }).from(volunteers).where(and(...where));
  const perms = await permissionsOf(db, rows.map((r) => r.id));
  return rows.filter((r) => perms.get(r.id)?.includes(permission));
}
