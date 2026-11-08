import { ORPCError } from "@orpc/server";
import { ChatError, getChat } from "../chat/service.js";
import { getWaDeps } from "../whatsapp/context.js";
import { logAccess } from "./logAccess.js";
import { mapDomainError, os, requirePermission } from "./base.js";

const chat = () => getChat(getWaDeps());
const view = requirePermission("conversations.view");
const reply = requirePermission("conversations.reply");

async function detail(beneficiaryId: string) {
  const d = await chat().get(beneficiaryId);
  if (!d) throw new ORPCError("NOT_FOUND");
  return d;
}

export const conversationsRouter = {
  list: os.conversations.list.use(view).handler(({ input, context }) =>
    chat().list({ filter: input.filter, cursor: input.cursor, limit: input.limit, volunteerId: context.volunteer.id })),

  attentionCount: os.conversations.attentionCount.use(view).handler(async () => ({ count: await chat().attentionCount() })),

  get: os.conversations.get.use(view).handler(async ({ input, context }) => {
    const d = await detail(input.beneficiaryId);
    await logAccess(context, "conversations.view", input.beneficiaryId);
    return d;
  }),

  approveDraft: os.conversations.approveDraft.use(reply).handler(async ({ input, context }) => {
    try {
      const id = await chat().approveDraft(input.messageId, context.volunteer.id, input.textFr);
      await logAccess(context, input.textFr ? "conversations.approve_edited" : "conversations.approve", input.messageId);
      await getWaDeps().jobs.drain?.();
      return await detail(id);
    } catch (e) { return mapDomainError(e); }
  }),

  rejectDraft: os.conversations.rejectDraft.use(reply).handler(async ({ input, context }) => {
    try {
      const id = await chat().rejectDraft(input.messageId, context.volunteer.id);
      await logAccess(context, "conversations.reject", input.messageId);
      return await detail(id);
    } catch (e) { return mapDomainError(e); }
  }),

  reply: os.conversations.reply.use(reply).handler(async ({ input, context }) => {
    try {
      await chat().volunteerReply(input.beneficiaryId, context.volunteer.id, input.textFr);
      await logAccess(context, "conversations.reply", input.beneficiaryId);
      return await detail(input.beneficiaryId);
    } catch (e) { return mapDomainError(e); }
  }),

  takeOver: os.conversations.takeOver.use(reply).handler(async ({ input, context }) => {
    try {
      await chat().takeOver(input.beneficiaryId, context.volunteer.id, { force: input.force });
      await logAccess(context, input.force ? "conversations.take_over_forced" : "conversations.take_over", input.beneficiaryId);
      await getWaDeps().jobs.drain?.();
      return await detail(input.beneficiaryId);
    } catch (e) { return mapDomainError(e); }
  }),

  resolve: os.conversations.resolve.use(reply).handler(async ({ input, context }) => {
    try {
      await chat().resolve(input.beneficiaryId, context.volunteer.id);
      await logAccess(context, "conversations.resolve", input.beneficiaryId);
      return await detail(input.beneficiaryId);
    } catch (e) { return mapDomainError(e); }
  }),
};
