import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

/**
 * Fine-grained permissions. Server checks permissions, never roles; roles are only named bundles.
 * POC: every volunteer gets the "volunteer" bundle. Later: custom bundles / per-volunteer grants.
 */
export const PermissionSchema = z.enum([
  "letters.review", // see queue, read analysis, edit, approve, reject
  "letters.view_photo",
  "beneficiaries.view",
  "beneficiaries.edit", // change language
  "documents.view_metadata",
  "documents.view_file",
  "documents.edit", // fix type / expiry, archive
  "sandbox.use",
  "volunteers.manage",
  "audit.view",
  "knowledge.view", // browse sources, test search
  "knowledge.manage", // trigger a sync
  "conversations.view", // read chatbot conversations
  "conversations.reply", // approve/reject drafts, reply, resolve
  "usage.manage", // see Claude API usage and costs, set the monthly budget
  "notes.view", // read case notes and follow-up tasks on a person, see "my tasks"
  "notes.write", // add notes and tasks, edit/delete own notes, tick tasks done (needs notes.view to see them)
  "notes.moderate", // edit or delete anyone's note or task text
  "tasks.assign", // give a task to another volunteer (without it: only to yourself or to nobody)
  "skills.view", // browse the skills directory and the "who can help" suggestions
  "skills.edit_own", // fill in your own languages and skills
  "numbers.moderate", // release a number held by the flood guard, block or unblock a number
]);
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * responder: answers beneficiaries in Conversations only (no letters, documents or files). Default for self-signups.
 * volunteer: full volunteer bundle (letters, documents, conversations). admin: + volunteers, audit, knowledge sync, usage.
 */
export const VolunteerRoleSchema = z.enum(["responder", "volunteer", "admin"]);
export type VolunteerRole = z.infer<typeof VolunteerRoleSchema>;

const VOLUNTEER: Permission[] = [
  "letters.review",
  "letters.view_photo",
  "beneficiaries.view",
  "beneficiaries.edit",
  "documents.view_metadata",
  "documents.view_file",
  "documents.edit",
  "sandbox.use",
  "knowledge.view",
  "conversations.view",
  "conversations.reply",
  "notes.view",
  "notes.write",
  "tasks.assign",
  "skills.view",
  "skills.edit_own",
  "numbers.moderate",
];
/** Responders fill in their own skills (so hard cases can be routed to them) but see no case notes by default. */
const RESPONDER: Permission[] = ["conversations.view", "conversations.reply", "knowledge.view", "skills.edit_own"];
/**
 * Permissions that need two-factor authentication (when ADMIN_2FA=required, the default): an account holding any of
 * them without an authenticator app enrolled gets them withheld until it enrols.
 */
export const TWO_FACTOR_PERMISSIONS: readonly Permission[] = ["volunteers.manage", "audit.view", "usage.manage", "knowledge.manage", "notes.moderate"];

export const ROLE_PERMISSIONS: Record<VolunteerRole, readonly Permission[]> = {
  responder: RESPONDER,
  volunteer: VOLUNTEER,
  admin: [...VOLUNTEER, "volunteers.manage", "audit.view", "knowledge.manage", "usage.manage", "notes.moderate"],
};

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
});
export type Volunteer = z.infer<typeof VolunteerSchema>;

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
export const SignupInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(10).max(200),
  uiLanguage: LanguageSchema,
  /** "How would you like to help?" — read by the admin who approves. */
  note: z.string().trim().max(500).optional(),
  /** Must be true: the person accepts the confidentiality commitment shown on the form. */
  acceptsConfidentiality: z.literal(true),
  /** Honeypot: hidden from people, filled in by bots. A non-empty value is silently ignored. */
  website: z.string().max(200).optional(),
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
  createdAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
  approvedByName: z.string().nullable(),
  /** False while a self-signup has not clicked the link in the verification e-mail (only when e-mail is set up). */
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
});
export type VolunteerAccount = z.infer<typeof VolunteerAccountSchema>;
