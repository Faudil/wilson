import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { ASSOCIATION_ADMIN_PERMISSIONS, ROLE_PERMISSIONS, TWO_FACTOR_PERMISSIONS, type Permission, type SignupInput, type Volunteer, type VolunteerRole } from "@wilson/contracts";
import { alert } from "../alerts.js";
import type { Config } from "../config.js";
import type { Crypto } from "../crypto/keys.js";
import type { Db } from "../db/client.js";
import { associations, invitations, sessions, volunteerPermissions, volunteers } from "../db/schema.js";
import { getMailer } from "../mail.js";
import { Attempts, Locks } from "./limiter.js";
import { newTotpSecret, totpUri, verifyTotp } from "./totp.js";

// Bun's built-in argon2id (PHC string), OWASP-ish params: 19 MiB, 2 passes.
const ARGON = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;

export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, ARGON);
const verify = (hash: string, password: string): Promise<boolean> => Bun.password.verify(password, hash);
export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

type VolunteerRow = typeof volunteers.$inferSelect;

/**
 * Role bundle + association-admin rights (members.manage, only with an association) + per-person overrides.
 * Overrides come last, so a global admin can still revoke members.manage from one association admin.
 */
export function effectivePermissions(
  role: VolunteerRole,
  overrides: { permission: Permission; granted: boolean }[],
  association: { associationId: string | null; associationAdmin: boolean } = { associationId: null, associationAdmin: false },
): Permission[] {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  if (association.associationAdmin && association.associationId) for (const p of ASSOCIATION_ADMIN_PERMISSIONS) set.add(p);
  for (const o of overrides) {
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

/**
 * Effective permissions of other volunteers (task assignee checks, directory). Pending and disabled accounts get none.
 * One query for the accounts and one for the overrides, whatever the number of ids.
 */
export async function permissionsOf(db: Db, ids: string[]): Promise<Map<string, Permission[]>> {
  const out = new Map<string, Permission[]>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await db.select({
    id: volunteers.id, role: volunteers.role, disabledAt: volunteers.disabledAt, pending: volunteers.pendingApproval,
    associationId: volunteers.associationId, associationAdmin: volunteers.associationAdmin,
  })
    .from(volunteers).where(inArray(volunteers.id, unique));
  const overrides = await db.select().from(volunteerPermissions).where(inArray(volunteerPermissions.volunteerId, unique));
  for (const r of rows) {
    if (r.disabledAt || r.pending) {
      out.set(r.id, []);
      continue;
    }
    const own = overrides.filter((o) => o.volunteerId === r.id) as { permission: Permission; granted: boolean }[];
    out.set(r.id, effectivePermissions(r.role as VolunteerRole, own, r));
  }
  return out;
}

export type LoginResult =
  | { kind: "ok"; token: string; expires: Date; volunteer: Volunteer }
  /** Unknown e-mail, wrong password, wrong 2FA code or disabled account (indistinguishable on purpose). */
  | { kind: "invalid" }
  /** Right password, account not approved yet. */
  | { kind: "pending" }
  /** Right password, the account has an authenticator app: ask for the code (`invalid_code` = it was wrong). */
  | { kind: "two_factor"; invalidCode: boolean }
  | { kind: "locked"; retryAfterSeconds: number };

export interface AuthService {
  login(email: string, password: string, opts?: { totp?: string; ip?: string | null }): Promise<LoginResult>;
  /**
   * Self-signup: creates a pending account (no permissions until an admin approves it). Silently does nothing when
   * the email already exists or the honeypot is filled. Throws SignupError when the pending list is full or too many
   * requests came in. Sends the verification e-mail when SMTP is set up.
   */
  signup(input: SignupInput, opts?: { ip?: string | null }): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  logout(token: string): Promise<void>;
  resolveVolunteer(token: string): Promise<Volunteer | null>;
  setUiLanguage(volunteerId: string, language: Volunteer["uiLanguage"]): Promise<Volunteer>;
  /** null = already enabled (disable it first). */
  twoFactorSetup(volunteerId: string): Promise<{ secret: string; uri: string } | null>;
  /** false = wrong code. */
  twoFactorEnable(volunteerId: string, code: string): Promise<Volunteer | false>;
  twoFactorDisable(volunteerId: string, code: string): Promise<Volunteer | false>;
}

export class SignupError extends Error {
  constructor(readonly reason: "too_many_pending" | "rate_limited" | "signup_closed", readonly retryAfterSeconds = 0) {
    super(reason);
    this.name = "SignupError";
  }
}

export const INVITATION_TTL_DAYS = 7;

/** Open invitation for a raw token, or null (unknown, used, revoked, expired). */
export async function openInvitation(db: Db, token: string, now: Date) {
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, sha256Hex(token))).limit(1);
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= now) return null;
  return inv;
}

const HOUR = 3600_000;
const EMAIL_TOKEN_TTL_MS = 48 * HOUR;

type AuthConfig = Pick<Config,
  "SESSION_TTL_HOURS" | "VOLUNTEER_SIGNUP" | "VOLUNTEER_SIGNUP_MAX_PENDING" | "SIGNUP_PER_IP_PER_HOUR" | "SIGNUP_PER_DAY" | "ADMIN_2FA" |
  "LOGIN_MAX_FAILURES" | "LOGIN_MAX_FAILURES_PER_IP" | "LOGIN_LOCK_MINUTES" | "SMTP_URL" | "MAIL_FROM" |
  "PUBLIC_BACKOFFICE_ORIGIN" | "ASSOCIATION_NAME" | "ALERT_WEBHOOK_URL">;

/** Permissions after the 2FA rule: admin permissions are withheld from accounts without an authenticator app. */
export function withTwoFactorRule(perms: Permission[], enrolled: boolean, mode: "required" | "optional"): { permissions: Permission[]; missing: boolean } {
  if (enrolled || mode === "optional") return { permissions: perms, missing: false };
  const kept = perms.filter((p) => !TWO_FACTOR_PERMISSIONS.includes(p));
  return { permissions: kept, missing: kept.length !== perms.length };
}

const MAIL_TEXT: Record<"fr" | "en" | "ar", { subject: string; body: (link: string, name: string) => string }> = {
  fr: { subject: "Confirmez votre adresse e-mail", body: (link, name) => `Bonjour,\n\nPour confirmer votre demande d'inscription comme bénévole à ${name}, ouvrez ce lien (valable 48 heures) :\n\n${link}\n\nUn·e responsable validera ensuite votre compte. Si vous n'avez rien demandé, ignorez ce message.` },
  en: { subject: "Confirm your e-mail address", body: (link, name) => `Hello,\n\nTo confirm your volunteer signup with ${name}, open this link (valid for 48 hours):\n\n${link}\n\nA coordinator will then approve your account. If you did not ask for this, ignore this message.` },
  ar: { subject: "أكّد عنوان بريدك الإلكتروني", body: (link, name) => `مرحبا،\n\nلتأكيد طلب تسجيلك كمتطوع في ${name}، افتح هذا الرابط (صالح لمدة 48 ساعة):\n\n${link}\n\nسيوافق أحد المسؤولين بعد ذلك على حسابك. إذا لم تطلب ذلك، تجاهل هذه الرسالة.` },
};

export function createAuthService(deps: { db: Db; config: AuthConfig; crypto: Crypto; now: () => Date }): AuthService {
  const { db, config } = deps;
  const failuresByEmail = new Attempts(config.LOGIN_LOCK_MINUTES * 60_000);
  const failuresByIp = new Attempts(config.LOGIN_LOCK_MINUTES * 60_000);
  const locks = new Locks();
  const signupsByIp = new Attempts(HOUR);
  const signupsAll = new Attempts(24 * HOUR);

  async function toVolunteer(row: VolunteerRow): Promise<Volunteer> {
    const overrides = await db.select().from(volunteerPermissions).where(eq(volunteerPermissions.volunteerId, row.id));
    const all = effectivePermissions(row.role as VolunteerRole, overrides as { permission: Permission; granted: boolean }[], row);
    const { permissions, missing } = withTwoFactorRule(all, !!row.totpEnabledAt, config.ADMIN_2FA);
    const [assoc] = row.associationId
      ? await db.select({ id: associations.id, name: associations.name }).from(associations).where(eq(associations.id, row.associationId)).limit(1)
      : [];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as VolunteerRole,
      uiLanguage: row.uiLanguage,
      permissions,
      twoFactorEnabled: !!row.totpEnabledAt,
      twoFactorMissing: missing,
      association: assoc ?? null,
      associationAdmin: !!assoc && row.associationAdmin,
    };
  }

  // Constant-ish work for unknown emails so timing does not reveal which accounts exist.
  let dummyHash: Promise<string> | null = null;

  async function failed(emailKey: string, ipKey: string | null, now: number): Promise<void> {
    if (failuresByEmail.add(emailKey, now) >= config.LOGIN_MAX_FAILURES) {
      failuresByEmail.clear(emailKey);
      const seconds = locks.lock(emailKey, now, config.LOGIN_LOCK_MINUTES * 60_000);
      void alert(deps, "auth.lock", `${config.LOGIN_MAX_FAILURES} failed logins on one account: it is locked for ${Math.round(seconds / 60)} min. Someone may be guessing a password.`);
    }
    if (ipKey && failuresByIp.add(ipKey, now) === config.LOGIN_MAX_FAILURES_PER_IP) {
      void alert(deps, "auth.ip", `${config.LOGIN_MAX_FAILURES_PER_IP} failed logins from one IP address in ${config.LOGIN_LOCK_MINUTES} min: it is blocked for a while.`);
    }
  }

  function decryptSecret(row: VolunteerRow): string | null {
    if (!row.totpSecretEnc || !row.totpWrappedDek) return null;
    return deps.crypto.decrypt(deps.crypto.unwrapDek(row.totpWrappedDek), row.totpSecretEnc).toString("utf8");
  }

  async function mustRow(id: string): Promise<VolunteerRow> {
    const [row] = await db.select().from(volunteers).where(eq(volunteers.id, id));
    if (!row) throw new Error("volunteer not found");
    return row;
  }

  return {
    async login(rawEmail, password, opts = {}) {
      const email = rawEmail.trim().toLowerCase();
      const now = deps.now().getTime();
      const emailKey = `e:${email}`;
      const ipKey = opts.ip ? `ip:${opts.ip}` : null;
      const lockedFor = Math.max(
        locks.lockedFor(emailKey, now),
        ipKey && failuresByIp.count(ipKey, now) >= config.LOGIN_MAX_FAILURES_PER_IP ? failuresByIp.retryAfter(ipKey, now) : 0,
      );
      if (lockedFor > 0) return { kind: "locked", retryAfterSeconds: lockedFor };

      const [row] = await db.select().from(volunteers).where(eq(volunteers.email, email));
      if (!row || row.disabledAt) {
        dummyHash ??= hashPassword("not-a-real-password");
        await verify(await dummyHash, password).catch(() => false);
        await failed(emailKey, ipKey, now);
        return { kind: "invalid" };
      }
      if (!(await verify(row.passwordHash, password).catch(() => false))) {
        await failed(emailKey, ipKey, now);
        return { kind: "invalid" };
      }
      if (row.pendingApproval) return { kind: "pending" };
      if (row.totpEnabledAt) {
        if (!opts.totp) return { kind: "two_factor", invalidCode: false };
        const secret = decryptSecret(row);
        const step = secret ? verifyTotp(secret, opts.totp, deps.now(), row.totpLastStep) : null;
        if (step === null) {
          await failed(emailKey, ipKey, now);
          return { kind: "two_factor", invalidCode: true };
        }
        // Conditional update: two logins racing with the same code cannot both pass.
        const used = await db.update(volunteers).set({ totpLastStep: step })
          .where(and(eq(volunteers.id, row.id), sql`coalesce(${volunteers.totpLastStep}, -1) < ${step}`)).returning({ id: volunteers.id });
        if (!used.length) return { kind: "two_factor", invalidCode: true };
      }
      failuresByEmail.clear(emailKey);
      locks.clear(emailKey);
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(now + config.SESSION_TTL_HOURS * 3600_000);
      await db.insert(sessions).values({ idHash: sha256Hex(token), volunteerId: row.id, expiresAt: expires });
      return { kind: "ok", token, expires, volunteer: await toVolunteer(row) };
    },

    async signup(input, opts = {}) {
      const now = deps.now().getTime();
      const ipKey = opts.ip ? `ip:${opts.ip}` : null;
      if (ipKey && signupsByIp.count(ipKey, now) >= config.SIGNUP_PER_IP_PER_HOUR) {
        throw new SignupError("rate_limited", signupsByIp.retryAfter(ipKey, now));
      }
      if (signupsAll.count("all", now) >= config.SIGNUP_PER_DAY) {
        void alert(deps, "signup.flood", `more than ${config.SIGNUP_PER_DAY} volunteer signups in 24 h: new requests are refused for now. Check Plus → Bénévoles.`);
        throw new SignupError("rate_limited", signupsAll.retryAfter("all", now));
      }
      if (ipKey) signupsByIp.add(ipKey, now);
      signupsAll.add("all", now);
      if (input.website?.trim()) return; // honeypot: a bot filled the hidden field (it still counts above)

      const email = input.email.trim().toLowerCase();
      // Hash first, whatever happens next, so "already registered" and "new" take the same time.
      const passwordHash = await hashPassword(input.password);
      // Unverified requests whose link expired are dropped (they never had access).
      await db.delete(volunteers).where(and(eq(volunteers.pendingApproval, true), eq(volunteers.emailVerified, false), isNotNull(volunteers.emailTokenExpiresAt), lt(volunteers.emailTokenExpiresAt, deps.now())));
      const invitation = input.invitationToken ? await openInvitation(db, input.invitationToken, deps.now()) : null;
      // Without a valid invite this is a public sign-up: closed when VOLUNTEER_SIGNUP=off.
      if (!invitation && config.VOLUNTEER_SIGNUP !== "on") throw new SignupError("signup_closed");
      const [existing] = await db.select({ id: volunteers.id }).from(volunteers).where(eq(volunteers.email, email));
      if (existing) return; // the invite stays usable for the right address
      const claimed = {
        associationName: input.association?.name.trim() || null,
        associationSiren: input.association?.siren ?? null,
        associationRna: input.association?.rna ?? null,
        associationCity: input.association?.city ?? null,
      };

      if (invitation) {
        // Someone the inviter knows, reached by hand: active at once, no e-mail check, no pending cap.
        await db.transaction(async (tx) => {
          const [row] = await tx.insert(volunteers).values({
            email, passwordHash, name: input.name.trim(), role: invitation.role, uiLanguage: input.uiLanguage,
            pendingApproval: false, approvedAt: deps.now(), approvedBy: invitation.createdBy, emailVerified: true,
            signupNote: input.note?.trim() || null, associationId: invitation.associationId, ...claimed,
          }).onConflictDoNothing({ target: volunteers.email }).returning({ id: volunteers.id });
          if (!row) return;
          // Single use: only flips if still open (two tabs racing on the same link cannot both win).
          const used = await tx.update(invitations).set({ usedAt: deps.now(), usedBy: row.id })
            .where(and(eq(invitations.id, invitation.id), isNull(invitations.usedAt), isNull(invitations.revokedAt))).returning({ id: invitations.id });
          if (used.length === 0) throw new Error("invitation already used");
        });
        return;
      }

      const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(volunteers).where(eq(volunteers.pendingApproval, true));
      if ((pending?.n ?? 0) >= config.VOLUNTEER_SIGNUP_MAX_PENDING) throw new SignupError("too_many_pending");
      const mailer = getMailer(deps);
      const token = mailer ? randomBytes(32).toString("base64url") : null;
      // Picked from the register and known here (same SIREN/RNA) → the request goes to that association's admins.
      const ids = [claimed.associationSiren && eq(associations.siren, claimed.associationSiren), claimed.associationRna && eq(associations.rna, claimed.associationRna)].filter((c) => !!c);
      const [match] = ids.length ? await db.select({ id: associations.id }).from(associations).where(or(...ids)).limit(1) : [];
      const inserted = await db.insert(volunteers).values({
        email, passwordHash, name: input.name.trim(), role: "responder", uiLanguage: input.uiLanguage,
        pendingApproval: true, signupNote: input.note?.trim() || null, associationId: match?.id ?? null, ...claimed,
        emailVerified: !mailer,
        emailTokenHash: token ? sha256Hex(token) : null,
        emailTokenExpiresAt: token ? new Date(now + EMAIL_TOKEN_TTL_MS) : null,
      }).onConflictDoNothing({ target: volunteers.email }).returning({ id: volunteers.id });
      if (mailer && token && inserted.length) {
        const lang = input.uiLanguage === "fr" || input.uiLanguage === "ar" ? input.uiLanguage : "en";
        const link = `${config.PUBLIC_BACKOFFICE_ORIGIN.replace(/\/$/, "")}/#/verify/${token}`;
        const m = MAIL_TEXT[lang];
        await mailer.send(email, m.subject, m.body(link, config.ASSOCIATION_NAME)).catch((e: Error) => console.warn("[mail] verification e-mail failed", e.message));
      }
    },

    async verifyEmail(token) {
      await db.update(volunteers).set({ emailVerified: true, emailTokenHash: null, emailTokenExpiresAt: null })
        .where(and(eq(volunteers.emailTokenHash, sha256Hex(token)), gt(volunteers.emailTokenExpiresAt, deps.now())));
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

    async twoFactorSetup(volunteerId) {
      const row = await mustRow(volunteerId);
      if (row.totpEnabledAt) return null;
      const secret = newTotpSecret();
      const { dek, wrapped } = deps.crypto.newDek();
      await db.update(volunteers).set({ totpSecretEnc: deps.crypto.encrypt(dek, secret), totpWrappedDek: wrapped, totpLastStep: null }).where(eq(volunteers.id, volunteerId));
      return { secret, uri: totpUri(secret, row.email, config.ASSOCIATION_NAME) };
    },

    async twoFactorEnable(volunteerId, code) {
      const row = await mustRow(volunteerId);
      const secret = decryptSecret(row);
      const step = secret ? verifyTotp(secret, code, deps.now(), null) : null;
      if (step === null) return false;
      const [updated] = await db.update(volunteers).set({ totpEnabledAt: deps.now(), totpLastStep: step }).where(eq(volunteers.id, volunteerId)).returning();
      return toVolunteer(updated!);
    },

    async twoFactorDisable(volunteerId, code) {
      const row = await mustRow(volunteerId);
      const secret = decryptSecret(row);
      if (!row.totpEnabledAt || !secret || verifyTotp(secret, code, deps.now(), row.totpLastStep) === null) return false;
      const [updated] = await db.update(volunteers).set({ totpEnabledAt: null, totpSecretEnc: null, totpWrappedDek: null, totpLastStep: null }).where(eq(volunteers.id, volunteerId)).returning();
      return toVolunteer(updated!);
    },
  };
}
