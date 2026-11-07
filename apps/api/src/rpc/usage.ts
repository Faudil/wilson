import { ORPCError } from "@orpc/server";
import { getServices } from "../services.js";
import { os, requirePermission } from "./base.js";
import { logAccess } from "./logAccess.js";

export const usageRouter = {
  summary: os.usage.summary.use(requirePermission("usage.manage")).handler(({ context }) => getServices(context.deps).usage.summary()),

  setBudget: os.usage.setBudget.use(requirePermission("usage.manage")).handler(({ context, input }) =>
    getServices(context.deps).usage.setBudget(input, context.volunteer.id),
  ),

  listKeys: os.usage.listKeys.use(requirePermission("usage.manage")).handler(({ context }) => getServices(context.deps).usage.listKeys()),

  addKey: os.usage.addKey.use(requirePermission("usage.manage")).handler(async ({ context, input }) => {
    const k = await getServices(context.deps).usage.addKey(input, context.volunteer.id);
    await logAccess(context, "usage.add_key", k.id);
    return k;
  }),

  updateKey: os.usage.updateKey.use(requirePermission("usage.manage")).handler(async ({ context, input }) => {
    const k = await getServices(context.deps).usage.updateKey(input);
    if (!k) throw new ORPCError("NOT_FOUND");
    await logAccess(context, "usage.update_key", k.id);
    return k;
  }),

  removeKey: os.usage.removeKey.use(requirePermission("usage.manage")).handler(async ({ context, input }) => {
    if (!(await getServices(context.deps).usage.removeKey(input.id))) throw new ORPCError("NOT_FOUND");
    await logAccess(context, "usage.remove_key", input.id);
  }),
};
