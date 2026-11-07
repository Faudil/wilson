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
];
/** Responders fill in their own skills (so hard cases can be routed to them) but see no case notes by default. */
const RESPONDER: Permission[] = ["conversations.view", "conversations.reply", "knowledge.view", "skills.edit_own"];
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
});
export type Volunteer = z.infer<typeof VolunteerSchema>;

export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
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
});
export type VolunteerAccount = z.infer<typeof VolunteerAccountSchema>;
