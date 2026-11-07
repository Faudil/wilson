/**
 * S3-compatible object storage. Receives ONLY ciphertext (encrypt with crypto/keys.ts before `put`).
 * Key prefixes: `tmp/letters/<letterId>`, `documents/<beneficiaryId>/<documentId>`, `sandbox/<messageId>`.
 */
export interface BlobStore {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Server-side copy, used when a letter photo is saved to My documents. */
  copy(fromKey: string, toKey: string): Promise<void>;
}
