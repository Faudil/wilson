/** Codes a service can fail with; rpc/base.ts maps them 1:1 to oRPC error codes. */
export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST";

/** Base of every service error (letters, chat, buddies, places, broadcasts), so routers map them in one place. */
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string = code) {
    super(message);
    this.name = "DomainError";
  }
  /** Machine-readable detail for CONFLICT (the message by default). */
  get reason(): string {
    return this.message;
  }
}
