import { z } from "zod";
import { IdSchema } from "./common.js";
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
]);
export type Permission = z.infer<typeof PermissionSchema>;

export const VolunteerRoleSchema = z.enum(["volunteer", "admin"]);
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
];
export const ROLE_PERMISSIONS: Record<VolunteerRole, readonly Permission[]> = {
  volunteer: VOLUNTEER,
  admin: [...VOLUNTEER, "volunteers.manage", "audit.view", "knowledge.manage"],
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
