import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import type { WaWebhook } from "@wilson/contracts";
import { beneficiaries, documents, letters, messages } from "../db/schema.js";
import { dispatchDueReminders } from "../documents/reminders.js";
import { getWaDeps } from "../whatsapp/context.js";
import { putSandboxMedia } from "../whatsapp/sandbox.js";
import { processWebhookPayload } from "../whatsapp/webhook.js";
import { os, requirePermission } from "./base.js";

const sandboxOnly = os.middleware(async ({ next }) => {
  if (getWaDeps().config.WHATSAPP_MODE !== "sandbox") throw new ORPCError("FORBIDDEN", { message: "sandbox is disabled" });
  return next();
});
const guard = requirePermission("sandbox.use");

function payload(from: string, message: Record<string, unknown>): WaWebhook {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "sandbox",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "sandbox" },
          messages: [{ id: `sandbox.in.${randomUUID()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  } as WaWebhook;
}

async function findByPhone(phone: string) {
  const d = getWaDeps();
  const [b] = await d.db.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.waIdHash, d.crypto.lookupHash(phone))).limit(1);
  return b ?? null;
}

export const sandboxRouter = {
  send: os.sandbox.send.use(sandboxOnly).use(guard).handler(async ({ input }) => {
    const d = getWaDeps();
    if (input.text) await processWebhookPayload(d, payload(input.phone, { type: "text", text: { body: input.text } }));
    if (input.file) {
      const { beneficiary } = await d.beneficiaries.findOrCreateByWaId(input.phone);
      const mime = input.file.type || "application/octet-stream";
      const id = await putSandboxMedia(d, beneficiary.id, Buffer.from(await input.file.arrayBuffer()), mime);
      const msg = mime.startsWith("image/")
        ? { type: "image", image: { id, mime_type: mime } }
        : { type: "document", document: { id, mime_type: mime, filename: input.file.name } };
      await processWebhookPayload(d, payload(input.phone, msg));
    }
  }),

  thread: os.sandbox.thread.use(sandboxOnly).use(guard).handler(async ({ input }) => {
    const d = getWaDeps();
    const b = await findByPhone(input.phone);
    if (!b) return [];
    const dek = await d.beneficiaries.getDek(b.id);
    const rows = await d.db.select().from(messages).where(eq(messages.beneficiaryId, b.id)).orderBy(asc(messages.createdAt));
    // Bot drafts waiting for review (or rejected) were never sent to the phone.
    return rows.filter((m) => m.chatState !== "draft" && m.chatState !== "rejected").map((m) => ({
      id: m.id,
      direction: m.direction === "in" ? ("inbound" as const) : ("outbound" as const),
      at: m.createdAt.toISOString(),
      text: m.bodyEnc ? d.crypto.decrypt(dek, m.bodyEnc).toString("utf8") : null,
      hasMedia: m.mediaKey !== null,
    }));
  }),

  runReminders: os.sandbox.runReminders.use(sandboxOnly).use(guard).handler(async ({ input }) => {
    const d = getWaDeps();
    // 10:00 Europe/Paris on the requested date (noon UTC is always the same calendar day there; 10:00 local = 08:00/09:00 UTC).
    const asOf = parisTime(input.date, 10, d.config.TIMEZONE);
    const result: unknown = await dispatchDueReminders(d, asOf);
    const drain = (d.jobs as { drain?: () => Promise<unknown> }).drain;
    if (typeof drain === "function") await drain.call(d.jobs);
    const sent = typeof result === "number" ? result : typeof (result as { sent?: unknown } | null)?.sent === "number" ? (result as { sent: number }).sent : 0;
    return { sent };
  }),

  reset: os.sandbox.reset.use(sandboxOnly).use(guard).handler(async ({ input }) => {
    const d = getWaDeps();
    const b = await findByPhone(input.phone);
    if (!b) return;
    // Purge now instead of after the retention period: blobs first, then the rows (FK cascades).
    const l = letters, doc = documents, m = messages;
    const keys = [
      ...(await d.db.select({ k: l.photoKey }).from(l).where(eq(l.beneficiaryId, b.id))).map((r) => r.k),
      ...(await d.db.select({ k: doc.objectKey }).from(doc).where(eq(doc.beneficiaryId, b.id))).map((r) => r.k),
      ...(await d.db.select({ k: m.mediaKey }).from(m).where(eq(m.beneficiaryId, b.id))).map((r) => r.k),
    ];
    for (const k of keys) if (k) await d.blobs.delete(k).catch(() => undefined);
    await d.db.delete(beneficiaries).where(eq(beneficiaries.id, b.id));
  }),
};

/** UTC instant of `hour:00` local time on calendar `date` in `timezone`. */
function parisTime(date: string, hour: number, timezone: string): Date {
  const guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(guess);
  return new Date(guess.getTime() - (Number(local) - hour) * 3600 * 1000);
}
