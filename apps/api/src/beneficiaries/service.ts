/**
 * Beneficiary identity + keys — implemented by batch "api-core" (beneficiaries/serviceImpl.ts),
 * consumed by the webhook/conversation engine, letters and documents.
 */
import type { LanguageCode } from "@wilson/contracts";
import type { ConversationState } from "../db/schema.js";

export interface BeneficiaryRow {
  id: string;
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
}

export interface BeneficiariesService {
  /**
   * Lookup by HMAC of wa_id, then of the BSUID (`userId`); creates the row + a new DEK on first contact. `waId` is the
   * phone number, or the BSUID itself when WhatsApp hides the number. A phone number seen later replaces the BSUID.
   */
  findOrCreateByWaId(waId: string, userId?: string): Promise<{ beneficiary: BeneficiaryRow; created: boolean }>;
  /**
   * WhatsApp says the person changed phone number or BSUID: move the address to the new one, so letters, documents
   * and reminders follow them. Returns false when nobody matches, or the new number already belongs to someone else.
   */
  changeIdentity(from: { waId?: string; userId?: string }, to: { waId?: string; userId?: string }): Promise<boolean>;
  get(id: string): Promise<BeneficiaryRow | null>;
  /** Clear DEK for this beneficiary (cached per process for a few minutes). Throws if shredded. */
  getDek(id: string): Promise<Buffer>;
  /** Decrypted wa_id (phone number, or BSUID when the number is hidden), used only right before sending. */
  getWaId(id: string): Promise<string>;
  setLanguage(id: string, language: LanguageCode, confirmed: boolean): Promise<void>;
  setConversationState(id: string, state: ConversationState): Promise<void>;
  touchInbound(id: string, at: Date): Promise<void>;
  /** "Delete all my data": archive beneficiary + documents, purge after ARCHIVE_RETENTION_DAYS (then DEK destroyed). */
  archiveAll(id: string): Promise<void>;
  /** First name or nickname volunteers gave the person, decrypted from `nickname_enc` (null when none or unreadable). */
  readNickname(id: string, enc: Buffer | null): Promise<string | null>;
  /** Empty or null removes it. */
  setNickname(id: string, nickname: string | null): Promise<string | null>;
  /** "+33 •• •• •• •• 21" */
  label(id: string): Promise<string>;
}
