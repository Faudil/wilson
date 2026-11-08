import { eq } from "drizzle-orm";
import { processInbound } from "../conversation/engine.js";
import { messages } from "../db/schema.js";
import type { WaDeps } from "../whatsapp/context.js";
import type { InboundMessage } from "./types.js";

/**
 * What every channel's webhook does with one inbound message, once authenticated and parsed: run the conversation,
 * then the read receipt. Never throws, so one bad message does not stop the others of the same webhook.
 */
export async function receiveInbound(deps: WaDeps, msg: InboundMessage): Promise<void> {
  try {
    await processInbound(deps, msg);
  } catch (e) {
    console.error(`[${msg.channel}] processing message ${msg.id} failed`, (e as Error).message);
  }
  if (!deps.channels.has(msg.channel)) return;
  deps.channels.get(msg.channel).markRead?.(msg.id).catch((e: Error) => console.warn(`[${msg.channel}] mark read failed`, e.message));
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";
const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Delivery receipt for one of our messages (by the id its transport returned). Never moves a status backwards. */
export async function applyDeliveryStatus(deps: WaDeps, messageId: string, status: DeliveryStatus): Promise<void> {
  const [row] = await deps.db.select({ id: messages.id, status: messages.status }).from(messages).where(eq(messages.waMessageId, messageId)).limit(1);
  if (!row) return;
  if (status !== "failed" && (STATUS_RANK[status] ?? 0) <= (STATUS_RANK[row.status] ?? 0)) return;
  await deps.db.update(messages).set({ status }).where(eq(messages.id, row.id));
}
