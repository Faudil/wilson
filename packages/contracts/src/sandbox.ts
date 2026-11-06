import { z } from "zod";
import { TimestampSchema } from "./common.js";

/** Fake phone numbers accepted by the sandbox. E.164 without "+", like Meta's `wa_id`. */
export const SandboxPhoneSchema = z.string().regex(/^\d{8,15}$/);

export const SandboxMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  at: TimestampSchema,
  text: z.string().nullable(),
  /** For inbound images: an object URL is built client-side; server only reports presence. */
  hasMedia: z.boolean(),
});

export const SandboxSendInputSchema = z.object({
  phone: SandboxPhoneSchema,
  text: z.string().max(4096).optional(),
  /** Photo or PDF of a letter/document. */
  file: z.file().max(10 * 1024 * 1024).optional(),
});
