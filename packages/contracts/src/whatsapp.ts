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
    type: z.enum(["button_reply", "list_reply"]),
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
  }),
});
const OtherMsg = z.object({ type: z.enum(["audio", "video", "sticker", "location", "contacts", "reaction", "unsupported"]) });

export const WaInboundMessageSchema = z
  .object({ id: z.string(), from: z.string(), timestamp: z.string() })
  .and(z.discriminatedUnion("type", [TextMsg, ImageMsg, DocumentMsg, InteractiveMsg, OtherMsg]));
export type WaInboundMessage = z.infer<typeof WaInboundMessageSchema>;

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
              .array(z.object({ id: z.string(), status: z.enum(["sent", "delivered", "read", "failed"]), recipient_id: z.string() }).passthrough())
              .optional(),
          }).passthrough(),
        }),
      ),
    }),
  ),
});
export type WaWebhook = z.infer<typeof WaWebhookSchema>;
