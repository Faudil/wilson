import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LanguageSchema } from "./languages.js";
import { VolunteerRoleSchema } from "./auth.js";
import { VOLUNTEER_SKILLS } from "./values.js";

/**
 * Skills directory: what each volunteer can do, so hard cases go to the right person.
 * Permissions: skills.edit_own (own profile), skills.view (directory + suggestions), volunteers.manage (edit anyone's).
 */
export const VolunteerSkillSchema = z.enum(VOLUNTEER_SKILLS);

export const SkillsInputSchema = z.object({
  /** Languages the volunteer can speak with people in (French is assumed for everyone). */
  languages: z.array(LanguageSchema).max(40).transform((l) => [...new Set(l)]),
  skills: z.array(VolunteerSkillSchema).transform((s) => [...new Set(s)]),
  /** "Available on Tuesday evenings", "Lawyer, Lyon bar"… Not about beneficiaries. */
  note: z.string().trim().max(300).nullable().default(null),
});
export type SkillsInput = z.infer<typeof SkillsInputSchema>;

export const VolunteerSkillsSchema = z.object({
  languages: z.array(LanguageSchema),
  skills: z.array(VolunteerSkillSchema),
  note: z.string().nullable(),
  updatedAt: TimestampSchema.nullable(),
});
export type VolunteerSkills = z.infer<typeof VolunteerSkillsSchema>;

export const DirectoryEntrySchema = VolunteerSkillsSchema.extend({
  volunteerId: IdSchema,
  name: z.string(),
  role: VolunteerRoleSchema,
  /** Has notes.view: can receive a follow-up task. */
  canTakeTasks: z.boolean(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const SkillMatchSchema = DirectoryEntrySchema.extend({
  speaksLanguage: z.boolean(),
  matchedSkills: z.array(VolunteerSkillSchema),
});
export type SkillMatch = z.infer<typeof SkillMatchSchema>;

export const SuggestionSchema = z.object({
  language: LanguageSchema,
  /** Skills looked for, from the person's latest chat intent (legal → legal + asylum…). */
  wanted: z.array(VolunteerSkillSchema),
  /** Best matches first; only volunteers who match the language or at least one wanted skill. Max 10. */
  volunteers: z.array(SkillMatchSchema),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;
