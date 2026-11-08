import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";
import { PERMISSIONS, ROLE_PERMISSIONS, VOLUNTEER_ROLES } from "./values.js";

/** Fine-grained permissions: the list, the role bundles and their rules live in values.ts (no zod, shared with the browser). */
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export const VolunteerRoleSchema = z.enum(VOLUNTEER_ROLES);
export type VolunteerRole = z.infer<typeof VolunteerRoleSchema>;
export { ROLE_PERMISSIONS };
/**
 * Permissions that need two-factor authentication (when ADMIN_2FA=required, the default): an account holding any of
 * them without an authenticator app enrolled gets them withheld until it enrols.
 */
export const TWO_FACTOR_PERMISSIONS: readonly Permission[] = [
  "volunteers.manage", "audit.view", "usage.manage", "knowledge.manage", "notes.moderate", "broadcasts.approve",
  "buddies.manage", "buddies.reports", "appointments.manage", "associations.manage", "members.manage",
];

export const VolunteerSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.email(),
  role: VolunteerRoleSchema,
  /** Effective permissions (role bundle + future per-volunteer grants). The UI hides what is not allowed. */
  permissions: z.array(PermissionSchema),
  uiLanguage: LanguageSchema,
  /** An authenticator app (TOTP) is enrolled: login asks for its 6-digit code. */
  twoFactorEnabled: z.boolean(),
  /** Admin rights are withheld until this account enrols an authenticator app (see TWO_FACTOR_PERMISSIONS). */
  twoFactorMissing: z.boolean(),
  /** Association the volunteer belongs to, and whether they administer its members. */
  association: z.object({ id: IdSchema, name: z.string() }).nullable().default(null),
  associationAdmin: z.boolean().default(false),
  /** Newest "What's new in Wilson" entry this volunteer has seen (null: never opened). */
  changelogSeen: z.string().nullable().default(null),
});
export type Volunteer = z.infer<typeof VolunteerSchema>;

/** Id of a "What's new" entry: its release date, with a letter when there are several that day (2026-11-08b). */
export const ChangelogIdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}[a-z]?$/);

export const TotpCodeSchema = z.string().trim().regex(/^\d{6}$/);

export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  /** 6-digit code from the authenticator app, for accounts that enrolled one. */
  totp: TotpCodeSchema.optional(),
});

export const TwoFactorSetupSchema = z.object({
  /** Base32 secret, for typing into the app by hand. */
  secret: z.string(),
  /** otpauth:// link: tapping it on the phone opens the authenticator app. */
  uri: z.string(),
});

/** Public self-signup. The account stays inactive (cannot log in) until an admin approves it. */
/**
 * The association a volunteer belongs to. `siren`/`rna` are set only when picked from the official register
 * (Recherche d'entreprises / RNA); a typed name without a match is kept as free text.
 */
export const AssociationRefSchema = z.object({
  name: z.string().trim().min(2).max(200),
  siren: z.string().regex(/^\d{9}$/).nullable().default(null),
  rna: z.string().regex(/^W[0-9A-Z]{9}$/).nullable().default(null),
  city: z.string().trim().max(100).nullable().default(null),
});
export type AssociationRef = z.infer<typeof AssociationRefSchema>;

export const AssociationSearchInputSchema = z.object({ query: z.string().trim().min(3).max(100) });

export const SignupInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(10).max(200),
  uiLanguage: LanguageSchema,
  /** "How would you like to help?" — read by the admin who approves. */
  note: z.string().trim().max(500).optional(),
  /** Which association the person volunteers with (picked from the register, or typed). */
  association: AssociationRefSchema.optional(),
  /** Must be true: the person accepts the confidentiality commitment shown on the form. */
  acceptsConfidentiality: z.literal(true),
  /** Honeypot: hidden from people, filled in by bots. A non-empty value is silently ignored. */
  website: z.string().max(200).optional(),
  /** Token of an invite link (#/join/<token>): the account is created active, in the inviting association. */
  invitationToken: z.string().min(20).max(100).optional(),
});
export type SignupInput = z.infer<typeof SignupInputSchema>;

export const VolunteerAccountStatusSchema = z.enum(["pending", "active", "disabled"]);
export type VolunteerAccountStatus = z.infer<typeof VolunteerAccountStatusSchema>;

/** Admin view of an account (Bénévoles screen). */
export const VolunteerAccountSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.email(),
  role: VolunteerRoleSchema,
  status: VolunteerAccountStatusSchema,
  uiLanguage: LanguageSchema,
  note: z.string().nullable(),
  association: AssociationRefSchema.nullable(),
  createdAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
  approvedByName: z.string().nullable(),
  /** Association the account belongs to (managed by its association admins), and whether it is one of them. */
  memberOf: z.object({ id: IdSchema, name: z.string() }).nullable(),
  associationAdmin: z.boolean(),
  /** Effective permissions (role bundle + the overrides below). */
  permissions: z.array(PermissionSchema),
  /** Per-person grants (granted: true) or revocations (false) on top of the role bundle. */
  overrides: z.array(z.object({ permission: PermissionSchema, granted: z.boolean() })),
  /** False while a self-signup has not clicked the link in the verification e-mail (only when e-mail is set up). */
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
});
export type VolunteerAccount = z.infer<typeof VolunteerAccountSchema>;

/** An association working on this instance (created by a global admin). */
export const AssociationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  siren: z.string().nullable(),
  rna: z.string().nullable(),
  city: z.string().nullable(),
  memberCount: z.number().int(),
  pendingCount: z.number().int(),
  admins: z.array(z.object({ id: IdSchema, name: z.string() })),
  createdAt: TimestampSchema,
});
export type Association = z.infer<typeof AssociationSchema>;

export const InvitationSchema = z.object({
  id: IdSchema,
  association: z.object({ id: IdSchema, name: z.string() }).nullable(),
  role: VolunteerRoleSchema,
  label: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  status: z.enum(["open", "used", "expired", "revoked"]),
  usedByName: z.string().nullable(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

/** What the join page shows before sign-up (public, from the token). */
export const InvitationPreviewSchema = z.object({
  valid: z.boolean(),
  associationName: z.string().nullable(),
  role: VolunteerRoleSchema.nullable(),
});
