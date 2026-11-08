import { getEvents } from "../events/service.js";
import { logAccess } from "./logAccess.js";
import { mapDomainError, os, requirePermission, type RpcContext } from "./base.js";

/**
 * Agenda. Each procedure needs its own permission (checked before anything is read); the association scope and
 * "organiser or events.manage" are checked on top in the service. Every change is logged.
 */
const view = requirePermission("events.view");
const join = requirePermission("events.view", "events.join");
/** Edit / cancel / remove someone: the organiser (events.create) or a manager (events.manage); the service decides which. */
const edit = requirePermission("events.view");
const create = requirePermission("events.view", "events.create");

const svc = (ctx: RpcContext) => getEvents(ctx.deps);

export const eventsRouter = {
  list: os.events.list.use(view).handler(({ input, context }) => svc(context).list(context.volunteer, input)),

  get: os.events.get.use(view).handler(({ input, context }) => svc(context).get(context.volunteer, input.id).catch(mapDomainError)),

  create: os.events.create.use(create).handler(async ({ input, context }) => {
    const e = await svc(context).create(context.volunteer, input).catch(mapDomainError);
    await logAccess(context, "events.create", e.id);
    return e;
  }),

  update: os.events.update.use(edit).handler(async ({ input, context }) => {
    const e = await svc(context).update(context.volunteer, input.id, input.event).catch(mapDomainError);
    await logAccess(context, "events.update", e.id);
    return e;
  }),

  cancel: os.events.cancel.use(edit).handler(async ({ input, context }) => {
    const e = await svc(context).cancel(context.volunteer, input.id).catch(mapDomainError);
    await logAccess(context, "events.cancel", e.id);
    return e;
  }),

  join: os.events.join.use(join).handler(async ({ input, context }) => {
    const e = await svc(context).join(context.volunteer, input.id).catch(mapDomainError);
    await logAccess(context, "events.join", e.id);
    return e;
  }),

  leave: os.events.leave.use(join).handler(async ({ input, context }) => {
    const e = await svc(context).leave(context.volunteer, input.id).catch(mapDomainError);
    await logAccess(context, "events.leave", e.id);
    return e;
  }),

  removeAttendee: os.events.removeAttendee.use(edit).handler(async ({ input, context }) => {
    const e = await svc(context).removeAttendee(context.volunteer, input.id, input.volunteerId).catch(mapDomainError);
    await logAccess(context, "events.remove_attendee", input.volunteerId);
    return e;
  }),

  preview: os.events.preview.use(view).handler(async ({ input, context }) => ({
    text: await svc(context).preview(context.volunteer, input.id, input.language).catch(mapDomainError),
  })),
};
