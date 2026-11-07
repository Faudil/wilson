import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { volunteers } from "../db/schema.js";
import { directory, getSkills, matchVolunteers, needsOf, setSkills } from "../skills/service.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission } from "./base.js";

const own = requirePermission("skills.edit_own");
const view = requirePermission("skills.view");

export const skillsRouter = {
  mine: os.skills.mine.use(own).handler(({ context }) => getSkills(context.deps.db, context.volunteer.id)),

  updateMine: os.skills.updateMine.use(own).handler(async ({ input, context }) => {
    const out = await setSkills(context.deps.db, context.volunteer.id, input, context.deps.now());
    await logAccess(context, "skills.update_own", context.volunteer.id);
    return out;
  }),

  directory: os.skills.directory.use(view).handler(({ input, context }) => directory(context.deps.db, input)),

  suggest: os.skills.suggest.use(view).handler(async ({ input, context }) => {
    const needs = await needsOf(context.deps.db, input.beneficiaryId);
    if (!needs) throw new ORPCError("NOT_FOUND");
    return { ...needs, volunteers: await matchVolunteers(context.deps.db, { language: needs.language, skills: needs.wanted }) };
  }),

  updateFor: os.skills.updateFor.use(requirePermission("volunteers.manage")).handler(async ({ input, context }) => {
    const { volunteerId, ...skills } = input;
    const [v] = await context.deps.db.select({ id: volunteers.id }).from(volunteers).where(eq(volunteers.id, volunteerId));
    if (!v) throw new ORPCError("NOT_FOUND");
    const out = await setSkills(context.deps.db, volunteerId, skills, context.deps.now());
    await logAccess(context, "skills.update_for", volunteerId);
    return out;
  }),
};
