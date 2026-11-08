import { ORPCError } from "@orpc/server";
import { getPlaces } from "../places/service.js";
import { logAccess } from "./logAccess.js";
import { guard, os, requirePermission } from "./base.js";

const view = requirePermission("places.view");
const manage = requirePermission("places.manage");

/** Every change is logged: what a place says reaches beneficiaries without review. */
export const placesRouter = {
  list: os.places.list.use(view).handler(({ input, context }) => getPlaces(context.deps).list(input.scope)),

  create: os.places.create.use(manage).handler(async ({ input, context }) => {
    const p = await getPlaces(context.deps).create(input, context.volunteer.id);
    await logAccess(context, "places.create", p.id);
    return p;
  }),

  update: os.places.update.use(manage).handler(async ({ input, context }) => {
    const p = await guard(() => getPlaces(context.deps).update(input.id, input.place, context.volunteer.id));
    await logAccess(context, "places.update", p.id);
    return p;
  }),

  remove: os.places.remove.use(manage).handler(async ({ input, context }) => {
    await guard(() => getPlaces(context.deps).remove(input.id, context.volunteer.id));
    await logAccess(context, "places.remove", input.id);
  }),

  preview: os.places.preview.use(view).handler(async ({ input, context }) => {
    const svc = getPlaces(context.deps);
    return { text: (await svc.messageFor(input.language)) ?? "" };
  }),
};
