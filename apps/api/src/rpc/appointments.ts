import { ORPCError } from "@orpc/server";
import { getAppointments } from "../appointments/service.js";
import { getServices } from "../services.js";
import { logAccess } from "./logAccess.js";
import { mapDomainError, os, requirePermission, type RpcContext } from "./base.js";

/**
 * Rendez-vous. Each procedure needs its own permission (checked here, before anything is read); holding the
 * appointment, the person's consent and the time window are checked on top in the service.
 */
const view = requirePermission("appointments.view");
const accept = requirePermission("appointments.view", "appointments.accept");
const slots = requirePermission("appointments.slots");
const documents = requirePermission("appointments.documents");
const manage = requirePermission("appointments.view", "appointments.manage");

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

const svc = (ctx: RpcContext) => getAppointments(ctx.deps);

export const appointmentsRouter = {
  list: os.appointments.list.use(view).handler(({ input, context }) => svc(context).list(input.view, context.volunteer).catch(mapDomainError)),

  counts: os.appointments.counts.use(view).handler(({ context }) => svc(context).counts(context.volunteer)),

  accept: os.appointments.accept.use(accept).handler(async ({ input, context }) => {
    const a = await svc(context).accept(input.id, context.volunteer, input).catch(mapDomainError);
    await logAccess(context, "appointments.accept", input.id);
    return a;
  }),

  release: os.appointments.release.use(accept).handler(async ({ input, context }) => {
    const a = await svc(context).release(input.id, context.volunteer).catch(mapDomainError);
    await logAccess(context, "appointments.release", input.id);
    return a;
  }),

  complete: os.appointments.complete.use(accept).handler(async ({ input, context }) => {
    const a = await svc(context).complete(input.id, context.volunteer).catch(mapDomainError);
    await logAccess(context, "appointments.complete", input.id);
    return a;
  }),

  cancel: os.appointments.cancel.use(manage).handler(async ({ input, context }) => {
    const a = await svc(context).cancel(input.id, context.volunteer).catch(mapDomainError);
    await logAccess(context, "appointments.cancel", input.id);
    return a;
  }),

  documents: os.appointments.documents.use(documents).handler(async ({ input, context }) => {
    const r = await svc(context).documentsGuard(input.id, context.volunteer).catch(mapDomainError);
    const list = await getServices(context.deps).documents.listForBeneficiary(r.beneficiaryId);
    await logAccess(context, "appointments.documents", input.id);
    return list;
  }),

  documentFile: os.appointments.documentFile.use(documents).handler(async ({ input, context }) => {
    const r = await svc(context).documentsGuard(input.id, context.volunteer).catch(mapDomainError);
    const docs = getServices(context.deps).documents;
    // Only the documents that person sees in "My documents": any other id is "not found", not a leak.
    const own = await docs.listForBeneficiary(r.beneficiaryId);
    if (!own.some((d) => d.id === input.documentId)) throw new ORPCError("NOT_FOUND");
    const { bytes, mimeType } = await docs.readFile(input.documentId);
    await logAccess(context, "appointments.document_file", input.documentId);
    return new File([new Uint8Array(bytes)], `document-${input.documentId}.${EXT[mimeType] ?? "bin"}`, { type: mimeType });
  }),

  slots: os.appointments.slots.use(slots).handler(({ input, context }) => svc(context).slots(input.scope, context.volunteer).catch(mapDomainError)),

  addSlot: os.appointments.addSlot.use(slots).handler(async ({ input, context }) => {
    const s = await svc(context).addSlot(context.volunteer, input).catch(mapDomainError);
    await logAccess(context, "appointments.add_slot", s.id);
    return s;
  }),

  removeSlot: os.appointments.removeSlot.use(slots).handler(async ({ input, context }) => {
    await svc(context).removeSlot(input.id, context.volunteer).catch(mapDomainError);
    await logAccess(context, "appointments.remove_slot", input.id);
  }),
};
