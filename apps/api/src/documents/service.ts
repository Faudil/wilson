/**
 * Documents service interface — implemented by batch "api-core" (documents/serviceImpl.ts),
 * consumed by the conversation engine (batch "whatsapp") and the RPC router.
 */
import type { DocumentDto, DocumentType } from "@wilson/contracts";

export interface DocumentsService {
  /** Encrypt + store an uploaded file (unconfirmed), queue `document.analyze`. */
  createFromUpload(input: { beneficiaryId: string; bytes: Buffer; mimeType: string; type?: DocumentType }): Promise<{ documentId: string }>;
  /** Save an existing letter photo as a document (type=letter), copying the encrypted blob. */
  createFromLetter(input: { letterId: string }): Promise<{ documentId: string }>;
  /** After analysis: set detected type/date (unconfirmed). Called by the document.analyze worker. */
  applyDetection(documentId: string, detection: { type: DocumentType; expiresAt: string | null; confidence: number; quote: string | null; promptVersion: string }): Promise<void>;
  /** Beneficiary confirmed in WhatsApp → confirmed=true and reminders (re)scheduled. */
  confirm(documentId: string): Promise<void>;
  /** Change expiry (user or volunteer); reschedules reminders. `null` = no expiry. */
  setExpiry(documentId: string, expiresAt: string | null, source: "entered_by_user" | "entered_by_volunteer"): Promise<void>;
  get(documentId: string): Promise<DocumentDto | null>;
  /** Non-archived, confirmed documents of a beneficiary, soonest expiry first. */
  listForBeneficiary(beneficiaryId: string): Promise<DocumentDto[]>;
  /** Archive (hide, cancel reminders, purgeAt = now + ARCHIVE_RETENTION_DAYS). */
  archive(documentId: string): Promise<DocumentDto>;
  /** Decrypted file bytes. */
  readFile(documentId: string): Promise<{ bytes: Buffer; mimeType: string }>;
}
