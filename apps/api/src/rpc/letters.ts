import { ORPCError } from "@orpc/server";
import { getWaDeps } from "../whatsapp/context.js";
import { logAccess } from "./logAccess.js";
import { mapDomainError, os, requirePermission } from "./base.js";

export const lettersRouter = {
  list: os.letters.list.use(requirePermission("letters.review")).handler(async ({ input }) =>
    getWaDeps().letters.list({ cursor: input.cursor, limit: input.limit, status: input.status }),
  ),

  get: os.letters.get.use(requirePermission("letters.review")).handler(async ({ input }) => {
    const d = await getWaDeps().letters.get(input.id);
    if (!d) throw new ORPCError("NOT_FOUND");
    return d;
  }),

  photo: os.letters.photo.use(requirePermission("letters.view_photo")).handler(async ({ input, context }) => {
    const p = await getWaDeps().letters.readPhoto(input.id);
    if (!p) throw new ORPCError("NOT_FOUND", { message: "photo no longer available" });
    await logAccess(context, "letters.photo", input.id);
    return new File([new Uint8Array(p.bytes)], "letter.jpg", { type: p.mimeType });
  }),

  edit: os.letters.edit.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.edit(input, context.volunteer.id);
      await logAccess(context, "letters.edit", input.id);
      return d;
    } catch (e) { return mapDomainError(e); }
  }),

  approve: os.letters.approve.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.approve(input.id, context.volunteer.id);
      await logAccess(context, "letters.approve", input.id);
      return d;
    } catch (e) { return mapDomainError(e); }
  }),

  reject: os.letters.reject.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.reject(input.id, context.volunteer.id, input.note);
      await logAccess(context, "letters.reject", input.id);
      return d;
    } catch (e) { return mapDomainError(e); }
  }),
};
