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
}

export interface BeneficiariesService {
  /** Lookup by HMAC of wa_id; creates the row + a new DEK on first contact. */
  findOrCreateByWaId(waId: string): Promise<{ beneficiary: BeneficiaryRow; created: boolean }>;
  get(id: string): Promise<BeneficiaryRow | null>;
  /** Clear DEK for this beneficiary (cached per process for a few minutes). Throws if shredded. */
  getDek(id: string): Promise<Buffer>;
  /** Decrypted wa_id, used only right before sending. */
  getWaId(id: string): Promise<string>;
  setLanguage(id: string, language: LanguageCode, confirmed: boolean): Promise<void>;
  setConversationState(id: string, state: ConversationState): Promise<void>;
  touchInbound(id: string, at: Date): Promise<void>;
  /** "Delete all my data": archive beneficiary + documents, purge after ARCHIVE_RETENTION_DAYS (then DEK destroyed). */
  archiveAll(id: string): Promise<void>;
  /** "+33 •• •• •• •• 21" */
  label(id: string): Promise<string>;
}
