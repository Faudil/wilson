import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { WaInboundMessage } from "@wilson/contracts";
import { documents, messages } from "../db/schema.js";
import { deleteAllData, processInbound } from "../conversation/engine.js";
import { getServices } from "../services.js";
import { getWaDeps } from "../whatsapp/context.js";
import { toInteractive } from "../whatsapp/interactive.js";
import { putWebMedia, webAddress } from "../whatsapp/web.js";
import { getWebAccounts, type WebResult } from "../webAccounts/service.js";
import { os, type RpcContext } from "./base.js";

/** Only the person's own session: volunteers' cookies are not looked at here. */
const signedIn = os.middleware(async ({ context, next }) => {
  if (!context.beneficiary) throw new ORPCError("UNAUTHORIZED");
  return next({ context: { beneficiary: context.beneficiary } });
});

type Errors = { TOO_MANY_REQUESTS: (o: { data: { retryAfterSeconds: number } }) => Error };
function refused(r: Exclude<WebResult<object>, { kind: "ok" }>, errors: Errors): never {
  switch (r.kind) {
    case "rate_limited": throw errors.TOO_MANY_REQUESTS({ data: { retryAfterSeconds: r.retryAfterSeconds } });
    case "closed": throw new ORPCError("FORBIDDEN", { message: "signup_closed" });
    case "locked": throw new ORPCError("FORBIDDEN", { message: "locked" });
    case "invalid": throw new ORPCError("UNAUTHORIZED");
  }
}

const web = (c: RpcContext) => getWebAccounts(c.deps);

/** A message from the web page, in the shape WhatsApp delivers, to the same engine. */
function inbound(beneficiaryId: string, body: Record<string, unknown>): WaInboundMessage {
  return { id: `web.in.${randomUUID()}`, from: webAddress(beneficiaryId), timestamp: String(Math.floor(Date.now() / 1000)), ...body } as WaInboundMessage;
}

export const meRouter = {
  info: os.me.info.handler(({ context }) => ({
    associationName: context.deps.config.ASSOCIATION_NAME,
    associationContact: context.deps.config.ASSOCIATION_CONTACT,
    signupOpen: context.deps.config.BENEFICIARY_SIGNUP === "on",
  })),

  signup: os.me.signup.handler(async ({ input, context, errors }) => {
    if (input.website) return refused({ kind: "invalid" }, errors); // honeypot
    const r = await web(context).signup(input, context.ip);
    if (r.kind !== "ok") return refused(r, errors);
    context.setBeneficiaryCookie(r.session.token, r.session.expires);
    return { me: r.me, words: r.words };
  }),

  login: os.me.login.handler(async ({ input, context, errors }) => {
    const r = await web(context).login(input.words, input.sharedDevice, context.ip);
    if (r.kind !== "ok") return refused(r, errors);
    context.setBeneficiaryCookie(r.session.token, r.session.expires);
    return r.me;
  }),

  redeem: os.me.redeem.handler(async ({ input, context, errors }) => {
    const r = await web(context).redeem(input.code, input.sharedDevice, context.ip);
    if (r.kind !== "ok") return refused(r, errors);
    context.setBeneficiaryCookie(r.session.token, r.session.expires);
    return { me: r.me, words: r.words };
  }),

  logout: os.me.logout.handler(async ({ context }) => {
    if (context.beneficiary) await web(context).logout(context.beneficiary.token);
    context.setBeneficiaryCookie(null);
  }),

  get: os.me.get.use(signedIn).handler(async ({ context }) => {
    const me = await web(context).me(context.beneficiary.id, context.beneficiary.sharedDevice);
    if (!me) throw new ORPCError("UNAUTHORIZED");
    return me;
  }),

  setLanguage: os.me.setLanguage.use(signedIn).handler(async ({ input, context }) => {
    await getServices(context.deps).beneficiaries.setLanguage(context.beneficiary.id, input.language, true);
    return (await web(context).me(context.beneficiary.id, context.beneficiary.sharedDevice))!;
  }),

  thread: os.me.thread.use(signedIn).handler(async ({ context }) => {
    const { deps } = context;
    const id = context.beneficiary.id;
    const dek = await getServices(deps).beneficiaries.getDek(id);
    const rows = await deps.db.select().from(messages).where(eq(messages.beneficiaryId, id)).orderBy(asc(messages.createdAt));
    // Bot drafts waiting for a volunteer (or rejected) were never sent: like on WhatsApp, the person does not see them.
    return rows.filter((m) => m.chatState !== "draft" && m.chatState !== "rejected" && m.status !== "queued").map((m) => {
      const text = m.bodyEnc ? deps.crypto.decrypt(dek, m.bodyEnc).toString("utf8") : null;
      const menu = m.direction === "out" && m.kind === "interactive" && text ? toInteractive(text) : null;
      return {
        id: m.id,
        direction: m.direction === "in" ? ("inbound" as const) : ("outbound" as const),
        at: m.createdAt.toISOString(),
        text,
        choices: menu ? menu.choices.map(({ id: choice, title, description }) => ({ id: choice, title: description ?? title })) : [],
      };
    });
  }),

  send: os.me.send.use(signedIn).handler(async ({ input, context }) => {
    const d = getWaDeps();
    const id = context.beneficiary.id;
    if (input.file) {
      const mime = input.file.type || "application/octet-stream";
      // Same as menu 1 (explain a letter) or menu 2 (keep a document) on WhatsApp, then the file.
      await d.beneficiaries.setConversationState(id, { step: input.fileKind === "document" ? "await_document_file" : "main_menu" });
      const mediaId = await putWebMedia(d, id, Buffer.from(await input.file.arrayBuffer()), mime);
      const caption = mime.startsWith("image/") ? "📷" : "📄";
      try {
        await processInbound(d, inbound(id, mime.startsWith("image/")
          ? { type: "image", image: { id: mediaId, mime_type: mime, caption } }
          : { type: "document", document: { id: mediaId, mime_type: mime, caption } }));
      } finally {
        // The letter or document now holds its own encrypted copy: the upload itself is not kept.
        await d.blobs.delete(mediaId).catch(() => undefined);
      }
    }
    if (input.text) await processInbound(d, inbound(id, { type: "text", text: { body: input.text } }));
  }),

  documents: os.me.documents.use(signedIn).handler(async ({ context }) => {
    const rows = await context.deps.db.select({ id: documents.id, type: documents.type, expiresAt: documents.expiresAt }).from(documents)
      .where(and(eq(documents.beneficiaryId, context.beneficiary.id), isNull(documents.archivedAt), eq(documents.confirmed, true)))
      .orderBy(asc(documents.expiresAt));
    return rows.map((r) => ({ id: r.id, type: r.type as never, expiresAt: r.expiresAt }));
  }),

  deleteAll: os.me.deleteAll.use(signedIn).handler(async ({ context }) => {
    await deleteAllData(getWaDeps(), context.beneficiary.id);
    await web(context).signOutEverywhere(context.beneficiary.id);
    context.setBeneficiaryCookie(null);
  }),
};
