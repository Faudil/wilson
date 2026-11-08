/**
 * Beneficiary identity + keys — implemented by batch "api-core" (beneficiaries/serviceImpl.ts),
 * consumed by the webhook/conversation engine, letters and documents.
 */
import type { LanguageCode } from "@wilson/contracts";
import type { ChannelId } from "../channels/types.js";
import type { ConversationState } from "../db/schema.js";

export interface BeneficiaryRow {
  id: string;
  /** Channel the person writes on; replies go back on it. */
  channel: ChannelId;
  language: LanguageCode;
  languageConfirmed: boolean;
  conversationState: ConversationState;
  lastInboundAt: Date | null;
  archivedAt: Date | null;
  /** Said yes to announcements (menu 6); null = never sent any. */
  announcementsOptInAt: Date | null;
  createdAt: Date;
  /** Flood guard: quarantined and blocked numbers are not processed (see whatsapp/guard.ts). */
  guardStatus: "none" | "quarantined" | "blocked";
  /** A web account ("Mon espace"): no phone number, address "web:<id>", no 24 h window. */
  web: boolean;
}

export interface BeneficiariesService {
  /**
   * Lookup by HMAC of the address on this channel, then of `userId` (WhatsApp BSUID); creates the row + a new DEK on
   * first contact. On WhatsApp `address` is the phone number, or the BSUID itself when WhatsApp hides the number; a
   * phone number seen later replaces the BSUID.
   */
  findOrCreate(channel: ChannelId, address: string, userId?: string): Promise<{ beneficiary: BeneficiaryRow; created: boolean }>;
  /** `findOrCreate("whatsapp", …)`. */
  findOrCreateByWaId(waId: string, userId?: string): Promise<{ beneficiary: BeneficiaryRow; created: boolean }>;
  /**
   * The channel says the person changed address (phone number, BSUID): move them to the new one, so letters,
   * documents and reminders follow. Returns false when nobody matches, or the new address already belongs to someone else.
   */
  changeIdentity(channel: ChannelId, from: { address?: string; userId?: string }, to: { address?: string; userId?: string }): Promise<boolean>;
  get(id: string): Promise<BeneficiaryRow | null>;
  /** Clear DEK for this beneficiary (cached per process for a few minutes). Throws if shredded. */
  getDek(id: string): Promise<Buffer>;
  /** Decrypted address on the person's channel (phone number, BSUID, chat id…), used only right before sending. */
  getWaId(id: string): Promise<string>;
  /** Channel + decrypted address: where replies go. */
  getAddress(id: string): Promise<{ channel: ChannelId; address: string }>;
  setLanguage(id: string, language: LanguageCode, confirmed: boolean): Promise<void>;
  setConversationState(id: string, state: ConversationState): Promise<void>;
  touchInbound(id: string, at: Date): Promise<void>;
  /** "Delete all my data": archive beneficiary + documents, purge after ARCHIVE_RETENTION_DAYS (then DEK destroyed). */
  archiveAll(id: string): Promise<void>;
  /** "+33 •• •• •• •• 21", or the account number "W-K7QD3M" of a web account. */
  label(id: string): Promise<string>;
}
