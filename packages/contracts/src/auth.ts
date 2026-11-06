import { z } from "zod";
import { IdSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";

export const VolunteerRoleSchema = z.enum(["volunteer", "admin"]);

export const VolunteerSchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.email(),
  role: VolunteerRoleSchema,
  uiLanguage: LanguageSchema,
});
export type Volunteer = z.infer<typeof VolunteerSchema>;

export const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});
