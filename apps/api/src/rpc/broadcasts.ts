import { ORPCError } from "@orpc/server";
import { BroadcastError, getBroadcasts } from "../broadcasts/service.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission, type RpcContext } from "./base.js";

const view = requirePermission("broadcasts.view");
const create = requirePermission("broadcasts.create");
const approve = requirePermission("broadcasts.approve");

async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BroadcastError) {
      if (e.code === "CONFLICT") throw new ORPCError("CONFLICT", { data: { reason: e.reason ?? "conflict" } });
      throw new ORPCError(e.code);
    }
    throw e;
  }
}

const canApprove = (ctx: RpcContext) => !!ctx.volunteer?.permissions.includes("broadcasts.approve");

export const broadcastsRouter = {
  list: os.broadcasts.list.use(view).handler(({ context }) => getBroadcasts(context.deps).list()),

  estimate: os.broadcasts.estimate.use(view).handler(({ input, context }) => getBroadcasts(context.deps).estimate(input.languages)),

  create: os.broadcasts.create.use(create).handler(async ({ input, context }) => {
    const b = await getBroadcasts(context.deps).create(input, context.volunteer.id);
    await logAccess(context, "broadcasts.create", b.id);
    return b;
  }),

  update: os.broadcasts.update.use(create).handler(async ({ input, context }) => {
    const b = await mapped(() => getBroadcasts(context.deps).update(input.id, input.broadcast, context.volunteer.id, canApprove(context)));
    await logAccess(context, "broadcasts.update", b.id);
    return b;
  }),

  preview: os.broadcasts.preview.use(view).handler(async ({ input, context }) => ({
    text: await mapped(() => getBroadcasts(context.deps).render(input.id, input.language)),
  })),

  approve: os.broadcasts.approve.use(approve).handler(async ({ input, context }) => {
    const b = await mapped(() => getBroadcasts(context.deps).approve(input.id, context.volunteer.id));
    await logAccess(context, "broadcasts.approve", b.id);
    return b;
  }),

  // Author with broadcasts.create, or anyone with broadcasts.approve: the service checks which.
  cancel: os.broadcasts.cancel.use(view).handler(async ({ input, context }) => {
    if (!context.volunteer.permissions.includes("broadcasts.create") && !canApprove(context)) throw new ORPCError("FORBIDDEN");
    const b = await mapped(() => getBroadcasts(context.deps).cancel(input.id, context.volunteer.id, canApprove(context)));
    await logAccess(context, "broadcasts.cancel", b.id);
    return b;
  }),
};
