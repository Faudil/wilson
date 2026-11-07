import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { ROLE_PERMISSIONS, type Permission, type Volunteer, type VolunteerRole } from "@wilson/contracts";
import type { Db } from "../db/client.js";
import { sessions, volunteerPermissions, volunteers } from "../db/schema.js";

// @node-rs/argon2: Algorithm.Argon2id === 2 (default). OWASP-ish params.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON);
export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

type VolunteerRow = typeof volunteers.$inferSelect;

export function effectivePermissions(role: VolunteerRole, overrides: { permission: Permission; granted: boolean }[]): Permission[] {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

export interface AuthService {
  login(email: string, password: string): Promise<{ token: string; expires: Date; volunteer: Volunteer } | null>;
  logout(token: string): Promise<void>;
  resolveVolunteer(token: string): Promise<Volunteer | null>;
  setUiLanguage(volunteerId: string, language: Volunteer["uiLanguage"]): Promise<Volunteer>;
}

export function createAuthService(deps: { db: Db; config: { SESSION_TTL_HOURS: number }; now: () => Date }): AuthService {
  const { db } = deps;

  async function toVolunteer(row: VolunteerRow): Promise<Volunteer> {
    const overrides = await db.select().from(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, row.id));
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as VolunteerRole,
      uiLanguage: row.uiLanguage,
      permissions: effectivePermissions(row.role as VolunteerRole, overrides as { permission: Permission; granted: boolean }[]),
    };
  }

  // Constant-ish work for unknown emails so timing does not reveal which accounts exist.
  let dummyHash: Promise<string> | null = null;

  return {
    async login(email, password) {
      const [row] = await db.select().from(volunteers).where(eq(volunteers.email, email.trim().toLowerCase()));
      if (!row || row.disabledAt) {
        dummyHash ??= hashPassword("not-a-real-password");
        await verify(await dummyHash, password).catch(() => false);
        return null;
      }
      if (!(await verify(row.passwordHash, password).catch(() => false))) return null;
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(deps.now().getTime() + deps.config.SESSION_TTL_HOURS * 3600_000);
      await db.insert(sessions).values({ idHash: sha256Hex(token), volunteerId: row.id, expiresAt: expires });
      return { token, expires, volunteer: await toVolunteer(row) };
    },

    async logout(token) {
      await db.delete(sessions).where(eq(sessions.idHash, sha256Hex(token)));
    },

    async resolveVolunteer(token) {
      const [r] = await db
        .select({ v: volunteers })
        .from(sessions)
        .innerJoin(volunteers, eq(volunteers.id, sessions.volunteerId))
        .where(and(eq(sessions.idHash, sha256Hex(token)), gt(sessions.expiresAt, deps.now())));
      if (!r || r.v.disabledAt) return null;
      return toVolunteer(r.v);
    },

    async setUiLanguage(volunteerId, language) {
      const [row] = await db.update(volunteers).set({ uiLanguage: language }).where(eq(volunteers.id, volunteerId)).returning();
      if (!row) throw new Error("volunteer not found");
      return toVolunteer(row);
    },
  };
}
