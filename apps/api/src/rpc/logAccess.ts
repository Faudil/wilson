import { accessLog } from "../db/schema.js";
import type { LogAccess } from "./base.js";

/** Append a row to access_log for the volunteer of this request. */
export const logAccess: LogAccess = async (ctx, action, targetId) => {
  if (!ctx.volunteer) throw new Error("logAccess requires an authenticated volunteer");
  await ctx.deps.db.insert(accessLog).values({ volunteerId: ctx.volunteer.id, action, targetId });
};
