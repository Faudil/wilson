/**
 * Envelope encryption. Integration point: every batch encrypts through these functions only.
 * Format of every ciphertext: 12-byte IV | 16-byte GCM tag | ciphertext.
 * Implementation owned by batch "data & security".
 */
export interface Crypto {
  /** New random 32-byte DEK, returned wrapped by MASTER_KEY (store) and clear (use, then drop). */
  newDek(): { wrapped: Buffer; dek: Buffer };
  unwrapDek(wrapped: Buffer): Buffer;
  encrypt(dek: Buffer, plaintext: Buffer | string): Buffer;
  decrypt(dek: Buffer, ciphertext: Buffer): Buffer;
  encryptJson(dek: Buffer, value: unknown): Buffer;
  decryptJson<T>(dek: Buffer, ciphertext: Buffer): T;
  /** HMAC-SHA256(LOOKUP_KEY, value) as hex. */
  lookupHash(value: string): string;
}
