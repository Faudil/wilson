import { ORPCError } from "@orpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { quickReplies } from "../db/schema.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission } from "./base.js";

type Row = typeof quickReplies.$inferSelect;
const toReply = (r: Row) => ({ id: r.id, title: r.title, text: r.text });
const manage = requirePermission("replies.manage");

/**
 * Saved answers for the conversation composer. They hold no personal data (French text written by admins), and are
 * sent through `conversations.reply` like any typed answer: translated, footer appended, reviewed by the volunteer.
 */
export const quickRepliesRouter = {
  list: os.quickReplies.list.use(requirePermission("conversations.reply")).handler(async ({ context }) =>
    (await context.deps.db.select().from(quickReplies).orderBy(asc(quickReplies.position), asc(quickReplies.createdAt))).map(toReply)),

  create: os.quickReplies.create.use(manage).handler(async ({ input, context }) => {
    const { db } = context.deps;
    const [top] = await db.select({ next: sql<number>`coalesce(max(${quickReplies.position}), 0)::int + 1` }).from(quickReplies);
    const [row] = await db.insert(quickReplies).values({ title: input.title, text: input.text, position: top?.next ?? 1, createdBy: context.volunteer.id }).returning();
    await logAccess(context, "quick_replies.create", row!.id);
    return toReply(row!);
  }),

  update: os.quickReplies.update.use(manage).handler(async ({ input, context }) => {
    const [row] = await context.deps.db.update(quickReplies)
      .set({ title: input.title, text: input.text, updatedAt: context.deps.now() })
      .where(eq(quickReplies.id, input.id)).returning();
    if (!row) throw new ORPCError("NOT_FOUND");
    await logAccess(context, "quick_replies.update", row.id);
    return toReply(row);
  }),

  remove: os.quickReplies.remove.use(manage).handler(async ({ input, context }) => {
    const gone = await context.deps.db.delete(quickReplies).where(eq(quickReplies.id, input.id)).returning({ id: quickReplies.id });
    if (!gone.length) throw new ORPCError("NOT_FOUND");
    await logAccess(context, "quick_replies.remove", input.id);
  }),
};
