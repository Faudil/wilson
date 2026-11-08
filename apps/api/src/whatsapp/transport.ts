import type { LanguageCode } from "@wilson/contracts";
import type { ChannelTransport } from "../channels/types.js";

/**
 * WhatsApp side of `ChannelTransport`. Two implementations: MetaTransport (Graph API) and SandboxTransport
 * (writes to `messages`, nothing leaves the server). Inbound goes through the webhook, whose WaWebhook payload is
 * turned into channel-neutral `InboundMessage`s (whatsapp/inbound.ts) — the sandbox fabricates the same payload.
 * `address` is the clear wa_id or BSUID (decrypted by the caller just before sending).
 */
export interface WhatsAppTransport extends ChannelTransport {
  readonly channel: "whatsapp";
  readonly mode: "sandbox" | "meta";
  /** Pre-approved utility/marketing template, used outside the 24 h window. `params` fill {{1}}, {{2}}… in order. */
  sendTemplate(address: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }>;
}
