import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { ROLE_PERMISSIONS, type Permission, type SignupInput, type Volunteer, type VolunteerRole } from "@wilson/contracts";
import type { Db } from "../db/client.js";
import { sessions, volunteerPermissions, volunteers } from "../db/schema.js";

// Bun's built-in argon2id (PHC string), OWASP-ish params: 19 MiB, 2 passes.
const ARGON = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;

export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, ARGON);
const verify = (hash: string, password: string): Promise<boolean> => Bun.password.verify(password, hash);
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
  /** null = unknown email, wrong password or disabled; "pending" = right password, account not approved yet. */
  login(email: string, password: string): Promise<{ token: string; expires: Date; volunteer: Volunteer } | "pending" | null>;
  /**
   * Self-signup: creates a pending account (no permissions until an admin approves it). Silently does nothing when
   * the email already exists. Throws SignupError when the pending list is full.
   */
  signup(input: SignupInput): Promise<void>;
  logout(token: string): Promise<void>;
  resolveVolunteer(token: string): Promise<Volunteer | null>;
  setUiLanguage(volunteerId: string, language: Volunteer["uiLanguage"]): Promise<Volunteer>;
}

export class SignupError extends Error {
  constructor(readonly reason: "too_many_pending") {
    super(reason);
    this.name = "SignupError";
  }
}

export function createAuthService(deps: { db: Db; config: { SESSION_TTL_HOURS: number; VOLUNTEER_SIGNUP_MAX_PENDING: number }; now: () => Date }): AuthService {
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
      if (row.pendingApproval) return "pending";
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(deps.now().getTime() + deps.config.SESSION_TTL_HOURS * 3600_000);
      await db.insert(sessions).values({ idHash: sha256Hex(token), volunteerId: row.id, expiresAt: expires });
      return { token, expires, volunteer: await toVolunteer(row) };
    },

    async signup(input) {
      const email = input.email.trim().toLowerCase();
      // Hash first, whatever happens next, so "already registered" and "new" take the same time.
      const passwordHash = await hashPassword(input.password);
      const [existing] = await db.select({ id: volunteers.id }).from(volunteers).where(eq(volunteers.email, email));
      if (existing) return;
      const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(volunteers).where(eq(volunteers.pendingApproval, true));
      if ((pending?.n ?? 0) >= deps.config.VOLUNTEER_SIGNUP_MAX_PENDING) throw new SignupError("too_many_pending");
      await db.insert(volunteers).values({
        email, passwordHash, name: input.name.trim(), role: "responder", uiLanguage: input.uiLanguage,
        pendingApproval: true, signupNote: input.note?.trim() || null,
      }).onConflictDoNothing({ target: volunteers.email });
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
      if (!r || r.v.disabledAt || r.v.pendingApproval) return null;
      return toVolunteer(r.v);
    },

    async setUiLanguage(volunteerId, language) {
      const [row] = await db.update(volunteers).set({ uiLanguage: language }).where(eq(volunteers.id, volunteerId)).returning();
      if (!row) throw new Error("volunteer not found");
      return toVolunteer(row);
    },
  };
}
