import { z } from "zod";

/**
 * Subset of the Meta WhatsApp Cloud API webhook payload we consume.
 * Not an oRPC procedure: Meta's format and the X-Hub-Signature-256 check (raw body) are imposed by Meta,
 * so `POST /webhooks/whatsapp` is a plain HTTP route validated with this schema.
 * The sandbox builds the very same payload, so both paths share one code path after parsing.
 */
const TextMsg = z.object({ type: z.literal("text"), text: z.object({ body: z.string() }) });
const ImageMsg = z.object({
  type: z.literal("image"),
  image: z.object({ id: z.string(), mime_type: z.string(), caption: z.string().optional() }),
});
const DocumentMsg = z.object({
  type: z.literal("document"),
  document: z.object({ id: z.string(), mime_type: z.string(), filename: z.string().optional(), caption: z.string().optional() }),
});
const InteractiveMsg = z.object({
  type: z.literal("interactive"),
  interactive: z.object({
    type: z.string(), // button_reply | list_reply (others, e.g. nfm_reply, carry neither and are ignored)
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  }),
});
/** Tap on a quick-reply button of a template message (e.g. "Recevoir" on explanation_ready). */
const ButtonMsg = z.object({ type: z.literal("button"), button: z.object({ text: z.string(), payload: z.string().optional() }) });
const OTHER_TYPES = ["audio", "video", "sticker", "location", "contacts", "reaction", "unsupported"] as const;
const OtherMsg = z.object({ type: z.enum(OTHER_TYPES) });

const StrictInbound = z
  .object({ id: z.string(), from: z.string(), timestamp: z.string() })
  .and(z.discriminatedUnion("type", [TextMsg, ImageMsg, DocumentMsg, InteractiveMsg, ButtonMsg, OtherMsg]));

/**
 * Meta adds message types over time (order, system, request_welcome…). One unknown or odd message must not make the
 * whole webhook payload fail validation (its other messages and statuses would be lost), so anything that does not
 * match a known shape becomes `type: "unsupported"` with its id/from/timestamp kept.
 */
export const WaInboundMessageSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || StrictInbound.safeParse(raw).success) return raw;
  const m = raw as Record<string, unknown>;
  return { id: m.id, from: m.from, timestamp: m.timestamp, type: "unsupported" };
}, StrictInbound);
export type WaInboundMessage = z.infer<typeof WaInboundMessageSchema>;

const STATUS_VALUES = ["sent", "delivered", "read", "failed"] as const;

export const WaWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messaging_product: z.literal("whatsapp"),
            metadata: z.object({ phone_number_id: z.string() }).passthrough(),
            messages: z.array(WaInboundMessageSchema).optional(),
            statuses: z
              .array(z.object({
                id: z.string(),
                // Unknown statuses (e.g. "deleted", "warning") are kept as null and skipped, not fatal.
                status: z.enum(STATUS_VALUES).nullable().catch(null),
                recipient_id: z.string(),
                errors: z.array(z.object({ code: z.number(), title: z.string().optional() }).passthrough()).optional(),
              }).passthrough())
              .optional(),
          }).passthrough(),
        }),
      ),
    }),
  ),
});
export type WaWebhook = z.infer<typeof WaWebhookSchema>;
