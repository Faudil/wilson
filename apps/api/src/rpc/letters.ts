import { ORPCError } from "@orpc/server";
import { accessLog } from "../db/schema.js";
import { LettersError } from "../letters/service.js";
import { getWaDeps } from "../whatsapp/context.js";
import { os, requirePermission } from "./base.js";

function mapErr(e: unknown): never {
  if (e instanceof LettersError) throw new ORPCError(e.code === "BAD_REQUEST" ? "BAD_REQUEST" : e.code, { message: e.message });
  throw e;
}

const log = (volunteerId: string, action: string, targetId: string) =>
  getWaDeps().db.insert(accessLog).values({ volunteerId, action, targetId });

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
    await log(context.volunteer.id, "letters.photo", input.id);
    return new File([new Uint8Array(p.bytes)], "letter.jpg", { type: p.mimeType });
  }),

  edit: os.letters.edit.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.edit(input, context.volunteer.id);
      await log(context.volunteer.id, "letters.edit", input.id);
      return d;
    } catch (e) { return mapErr(e); }
  }),

  approve: os.letters.approve.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.approve(input.id, context.volunteer.id);
      await log(context.volunteer.id, "letters.approve", input.id);
      return d;
    } catch (e) { return mapErr(e); }
  }),

  reject: os.letters.reject.use(requirePermission("letters.review")).handler(async ({ input, context }) => {
    try {
      const d = await getWaDeps().letters.reject(input.id, context.volunteer.id, input.note);
      await log(context.volunteer.id, "letters.reject", input.id);
      return d;
    } catch (e) { return mapErr(e); }
  }),
};
