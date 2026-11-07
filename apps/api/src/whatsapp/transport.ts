import type { LanguageCode } from "@wilson/contracts";
import type { Interactive } from "./interactive.js";

/**
 * Outbound side of WhatsApp. Two implementations: MetaTransport (Graph API) and SandboxTransport
 * (writes to `messages`, nothing leaves the server). Inbound always goes through `handleWebhook` with a
 * WaWebhook payload — the sandbox fabricates the same payload.
 * `to` is the clear wa_id (decrypted by the caller just before sending).
 */
export interface WhatsAppTransport {
  readonly mode: "sandbox" | "meta";
  /** Plain-text message (callers already applied bidi isolation). Returns the provider message id. */
  sendText(to: string, body: string): Promise<{ waMessageId: string }>;
  /**
   * Reply buttons or a list (see interactive.ts). `fallbackText` is the same menu as plain text: the sandbox records
   * it, so the thread reads like the typed menu. Optional: a transport without it gets the plain text.
   */
  sendInteractive?(to: string, message: Interactive, fallbackText: string): Promise<{ waMessageId: string }>;
  /** Pre-approved utility template, used outside the 24 h window. `params` fill {{1}}, {{2}}… in order. */
  sendTemplate(to: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }>;
  /** Fetch inbound media bytes by Meta media id. */
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
  /** Mark an inbound message as read (blue ticks). Optional: the sandbox has nothing to mark. */
  markRead?(waMessageId: string): Promise<void>;
}
