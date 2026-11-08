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
/** A shared location (📎 → Location). Used once to list nearby places, never stored. */
const LocationMsg = z.object({
  type: z.literal("location"),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: z.string().optional(), address: z.string().optional() }),
});
/**
 * Sent by WhatsApp itself: the person changed phone number (`user_changed_number`) or business-scoped user id
 * (`user_changed_user_id`). Older payloads name the new number `new_wa_id`, newer ones `wa_id`.
 */
const SystemMsg = z.object({
  type: z.literal("system"),
  system: z.object({
    type: z.string().optional(),
    wa_id: z.string().optional(),
    new_wa_id: z.string().optional(),
    user_id: z.string().optional(),
    previous_user_id: z.string().optional(),
  }).passthrough(),
});
const OTHER_TYPES = ["audio", "video", "sticker", "contacts", "reaction", "unsupported"] as const;
const OtherMsg = z.object({ type: z.enum(OTHER_TYPES) });

/**
 * Business-scoped user id (BSUID): ISO country code, a dot, then up to 128 alphanumerics (`US.13491208655302741918`;
 * parent ids look like `US.ENT.…`). Phone numbers (wa_id) are digits only, so the two never collide.
 */
export const BSUID_RE = /^[A-Z]{2}\.[A-Za-z0-9.]{1,140}$/;
export const isBsuid = (id: string): boolean => BSUID_RE.test(id);

/**
 * `from` is the sender's phone number (wa_id) or, when WhatsApp hides it (a person with a username who has not
 * written to this number for 30 days), their BSUID. Since April 2026 Meta sends `from_user_id` (the BSUID) on every
 * message and may omit `from`; the preprocess below fills `from` with the BSUID in that case.
 */
const StrictInbound = z
  .object({ id: z.string(), from: z.string(), from_user_id: z.string().optional(), timestamp: z.string() })
  .and(z.discriminatedUnion("type", [TextMsg, ImageMsg, DocumentMsg, InteractiveMsg, ButtonMsg, LocationMsg, SystemMsg, OtherMsg]));

/**
 * Meta adds message types over time (order, system, request_welcome…). One unknown or odd message must not make the
 * whole webhook payload fail validation (its other messages and statuses would be lost), so anything that does not
 * match a known shape becomes `type: "unsupported"` with its id/from/timestamp kept.
 */
export const WaInboundMessageSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const m = raw as Record<string, unknown>;
  const withFrom = typeof m.from === "string" ? m : { ...m, from: m.from_user_id };
  if (StrictInbound.safeParse(withFrom).success) return withFrom;
  return { id: m.id, from: withFrom.from, from_user_id: m.from_user_id, timestamp: m.timestamp, type: "unsupported" };
}, StrictInbound);
export type WaInboundMessage = z.infer<typeof WaInboundMessageSchema>;

/** A message without any sender id (neither phone nor BSUID) cannot be answered: it is dropped, not the payload. */
const InboundList = z.array(z.unknown()).transform((items) =>
  items.flatMap((m) => {
    const r = WaInboundMessageSchema.safeParse(m);
    return r.success ? [r.data] : [];
  }),
);

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
            messages: InboundList.optional(),
            statuses: z
              .array(z.object({
                id: z.string(),
                // Unknown statuses (e.g. "deleted", "warning") are kept as null and skipped, not fatal.
                status: z.enum(STATUS_VALUES).nullable().catch(null),
                // Omitted when a message went to a BSUID and the phone number is hidden; recipient_user_id is the BSUID.
                recipient_id: z.string().optional(),
                recipient_user_id: z.string().optional(),
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
