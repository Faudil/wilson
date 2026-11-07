import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import { WaWebhookSchema, type WaWebhook } from "@wilson/contracts";
import { processInbound } from "../conversation/engine.js";
import { messages } from "../db/schema.js";
import type { WaDeps } from "./context.js";

const MAX_BODY = 2 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export function verifySignature(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(header.slice("sha256=".length), expected);
}

function reply(res: ServerResponse, status: number, body = "", type = "text/plain"): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Plain Node HTTP handler for `/webhooks/whatsapp` (GET verification + POST events).
 * Pass `rawBody` if the server already consumed the stream. The returned promise resolves once the
 * (already answered) payload has been processed, which tests await; the server may ignore it.
 */
export async function handleWhatsAppWebhook(req: IncomingMessage, res: ServerResponse, deps: WaDeps, rawBody?: Buffer): Promise<void> {
  const { config } = deps;
  if (req.method === "GET") {
    const q = new URL(req.url ?? "/", "http://localhost").searchParams;
    const token = q.get("hub.verify_token");
    if (q.get("hub.mode") === "subscribe" && config.WHATSAPP_VERIFY_TOKEN && token && safeEqual(token, config.WHATSAPP_VERIFY_TOKEN)) {
      return reply(res, 200, q.get("hub.challenge") ?? "");
    }
    return reply(res, 403);
  }
  if (req.method !== "POST") return reply(res, 405);

  let body: Buffer;
  try {
    body = rawBody ?? (await readBody(req));
  } catch {
    return reply(res, 413);
  }

  if (config.WHATSAPP_MODE !== "sandbox") {
    const sig = req.headers["x-hub-signature-256"];
    if (!config.WHATSAPP_APP_SECRET || !verifySignature(config.WHATSAPP_APP_SECRET, body, Array.isArray(sig) ? sig[0] : sig)) {
      return reply(res, 401);
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return reply(res, 400);
  }
  const parsed = WaWebhookSchema.safeParse(json);
  // Always 200 for authenticated payloads we do not understand: Meta would retry them forever.
  reply(res, 200);
  if (!parsed.success) {
    console.warn("[whatsapp] ignored webhook payload that does not match the schema");
    return;
  }
  await processWebhookPayload(deps, parsed.data);
}

/** Shared by the HTTP webhook and the sandbox: statuses first, then messages in order. Never throws. */
export async function processWebhookPayload(deps: WaDeps, payload: WaWebhook): Promise<void> {
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      for (const st of change.value.statuses ?? []) {
        try {
          await applyStatus(deps, st.id, st.status);
        } catch (e) {
          console.error("[whatsapp] status update failed", (e as Error).message);
        }
      }
      for (const msg of change.value.messages ?? []) {
        try {
          await processInbound(deps, msg);
        } catch (e) {
          console.error(`[whatsapp] processing message ${msg.id} failed`, (e as Error).message);
        }
      }
    }
  }
}

async function applyStatus(deps: WaDeps, waMessageId: string, status: "sent" | "delivered" | "read" | "failed"): Promise<void> {
  const [row] = await deps.db.select({ id: messages.id, status: messages.status }).from(messages).where(eq(messages.waMessageId, waMessageId)).limit(1);
  if (!row) return;
  if (status !== "failed" && (STATUS_RANK[status] ?? 0) <= (STATUS_RANK[row.status] ?? 0)) return;
  await deps.db.update(messages).set({ status }).where(eq(messages.id, row.id));
}
