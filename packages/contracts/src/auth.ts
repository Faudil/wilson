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
export const SignupInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(10).max(200),
  uiLanguage: LanguageSchema,
  /** "How would you like to help?" — read by the admin who approves. */
  note: z.string().trim().max(500).optional(),
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
  createdAt: TimestampSchema,
  approvedAt: TimestampSchema.nullable(),
  approvedByName: z.string().nullable(),
  /** Effective permissions (role bundle + the overrides below). */
  permissions: z.array(PermissionSchema),
  /** Per-person grants (granted: true) or revocations (false) on top of the role bundle. */
  overrides: z.array(z.object({ permission: PermissionSchema, granted: z.boolean() })),
});
export type VolunteerAccount = z.infer<typeof VolunteerAccountSchema>;
