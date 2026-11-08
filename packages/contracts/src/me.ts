import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { DocumentTypeSchema } from "./documents.js";
import { LanguageSchema } from "./languages.js";
import { RECOVERY_WORDS, RECOVERY_WORD_COUNT, normaliseRecoveryWord } from "./values.js";

/**
 * "Mon espace": the web space where a person can use Wilson without WhatsApp and without a phone number.
 * The account is a name (any name, not checked) and RECOVERY_WORD_COUNT recovery words drawn from RECOVERY_WORDS.
 * The words are the only secret: the server keeps an HMAC of them, never the words.
 */

export { RECOVERY_WORDS, RECOVERY_WORD_COUNT, normaliseRecoveryWord, type RecoveryWord } from "./values.js";

const WORDS = new Set<string>(RECOVERY_WORDS.map(([w]) => w));
export const RecoveryWordSchema = z.string().transform(normaliseRecoveryWord).refine((w) => WORDS.has(w), "unknown_word");
export const RecoveryWordsSchema = z.array(RecoveryWordSchema).length(RECOVERY_WORD_COUNT);

/** "W-K7QD3M": the account number shown to the person and to volunteers (random, says nothing about the person). */
export const AccountHandleSchema = z.string().regex(/^W-[A-Z0-9]{6}$/);

/** A one-time code a volunteer gives to someone who lost their words: "K7QD-3MXA", valid 24 hours. */
export const UnlockCodeSchema = z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")).pipe(z.string().length(8));

export const MeSignupInputSchema = z.object({
  /** What we call the person: any name, need not be their real one. Stored encrypted. */
  name: z.string().trim().min(1).max(40),
  language: LanguageSchema,
  /** Must be true: they read the "what Wilson is / is not" screen. */
  accepted: z.literal(true),
  /** "This phone is shared with other people": the session ends after an hour. */
  sharedDevice: z.boolean().default(false),
  /** Honeypot: hidden field, must stay empty. */
  website: z.string().max(0).optional(),
});

export const MeLoginInputSchema = z.object({ words: RecoveryWordsSchema, sharedDevice: z.boolean().default(false) });
export const MeRedeemInputSchema = z.object({ code: UnlockCodeSchema, sharedDevice: z.boolean().default(false) });

export const MeSchema = z.object({
  name: z.string(),
  language: LanguageSchema,
  handle: AccountHandleSchema,
  sharedDevice: z.boolean(),
  /** The association, shown in the header and on "what Wilson is". */
  associationName: z.string(),
  associationContact: z.string(),
});
export type Me = z.infer<typeof MeSchema>;

/** Returned once, right after sign-up or an unlock code: the words are never shown again. */
export const MeWordsSchema = z.object({ me: MeSchema, words: z.array(z.string()).length(RECOVERY_WORD_COUNT) });

export const MeMessageSchema = z.object({
  id: IdSchema,
  direction: z.enum(["inbound", "outbound"]),
  at: TimestampSchema,
  text: z.string().nullable(),
  /** A menu: the buttons to show (id = the number to send). The "N - …" lines of `text` are then hidden. */
  choices: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type MeMessage = z.infer<typeof MeMessageSchema>;

export const MeSendInputSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  /** A letter or document photo / PDF. */
  file: z.file().max(10 * 1024 * 1024).optional(),
  /** What the file is: a letter to explain (default) or a document to keep. */
  fileKind: z.enum(["letter", "document"]).default("letter"),
});

export const MeDocumentSchema = z.object({ id: IdSchema, type: DocumentTypeSchema, expiresAt: z.iso.date().nullable() });

/** What a volunteer sees of a web account (person page). The name only on the detail page. */
export const WebAccountSchema = z.object({
  handle: AccountHandleSchema,
  name: z.string().nullable(),
  lockedAt: TimestampSchema.nullable(),
  /** An unlock code is waiting to be used until this time. */
  unlockCodeUntil: TimestampSchema.nullable(),
});
export type WebAccount = z.infer<typeof WebAccountSchema>;
