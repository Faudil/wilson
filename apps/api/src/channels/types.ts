import type { LanguageCode } from "@wilson/contracts";
import type { Interactive } from "../whatsapp/interactive.js";

/**
 * Messaging channels a person can reach Wilson on. Only WhatsApp is implemented today; Telegram and SMS are
 * reserved so a new adapter only has to implement `ChannelTransport` and turn its webhook into `InboundMessage`s
 * (see docs/channels.md). Stored in `beneficiaries.channel` as text, so adding one needs no migration.
 */
export const CHANNEL_IDS = ["whatsapp", "telegram", "sms"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** What sets a channel apart, read by the senders instead of `if (channel === …)`. */
export interface ChannelCapabilities {
  /**
   * WhatsApp's rule: free text only within 24 h of the person's last message; after that only a pre-approved template
   * (`sendTemplate`). Channels without it (Telegram, SMS, the sandbox) always get the text itself.
   */
  serviceWindow: boolean;
}

/**
 * Outbound side of a channel. `address` is the channel's own id for the person: a phone number or BSUID on WhatsApp,
 * a chat id on Telegram, a phone number for SMS. Message ids returned must be unique across channels: WhatsApp's
 * `wamid.…` as is, any other channel prefixed with its id (`telegram:12345`), because they share `messages.wa_message_id`.
 */
export interface ChannelTransport {
  readonly channel: ChannelId;
  /** Provider behind it ("meta", "sandbox", "twilio"…), for logs. "sandbox" = writes its own `messages` rows. */
  readonly mode: string;
  readonly capabilities: ChannelCapabilities;
  /** Plain-text message (callers already applied bidi isolation). Long texts: the transport splits them. */
  sendText(address: string, body: string): Promise<{ waMessageId: string }>;
  /**
   * Buttons or a list (see whatsapp/interactive.ts). `fallbackText` is the same menu as plain text. Optional: a
   * channel without buttons (SMS) gets `sendText(fallbackText)`.
   */
  sendInteractive?(address: string, message: Interactive, fallbackText: string): Promise<{ waMessageId: string }>;
  /** Pre-approved template, used outside the service window. Required when `capabilities.serviceWindow` is true. */
  sendTemplate?(address: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }>;
  /** Bytes of an inbound photo or file, by the `mediaId` the inbound adapter put in `InboundMessage`. */
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
  /** Show the person their message arrived (read receipt). Optional, best effort. */
  markRead?(messageId: string): Promise<void>;
}

/** What the person sent, in channel-neutral terms. The conversation engine only sees this. */
export type InboundContent =
  | { type: "text"; text: string }
  /** A photo or file. `kind` keeps image/document apart for the stored row; `mediaId` goes back to `downloadMedia`. */
  | { type: "file"; kind: "image" | "document"; mediaId: string; mime: string; caption?: string }
  /** Tap on one of our buttons or list rows: `id` is the menu number (same as typing it). */
  | { type: "choice"; id: string; title: string }
  /** Tap on a template's quick-reply button (opt-in to receive a waiting message, or "Stop" announcements). */
  | { type: "button"; text: string }
  | { type: "location"; lat: number; lon: number }
  | { type: "voice" }
  /** Video, sticker…: answered politely, never analysed. */
  | { type: "media_unsupported" }
  /** Emoji reaction: stored, never answered. */
  | { type: "reaction" }
  /** The channel says this person now has another address (new phone number, new WhatsApp BSUID). Never answered. */
  | { type: "identity_change"; address?: string; userId?: string; previousUserId?: string; reason?: string }
  /** Anything else the channel sends (contacts, new message types). */
  | { type: "other" };

export interface InboundMessage {
  channel: ChannelId;
  /** Unique across channels, same rule as outbound ids: `wamid.…` on WhatsApp, `<channel>:<id>` elsewhere. Dedup key. */
  id: string;
  /** The person's address on this channel (see `ChannelTransport`). */
  from: string;
  /** A second stable id for the same person, when the channel has one (WhatsApp BSUID next to the phone number). */
  userId?: string;
  content: InboundContent;
}
