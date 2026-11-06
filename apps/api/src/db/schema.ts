/**
 * Drizzle schema — the integration point shared by every batch.
 * Columns suffixed `Enc` hold AES-256-GCM ciphertext under the beneficiary DEK (see src/crypto/keys.ts).
 * Change this file only through a reviewed migration (`pnpm db:generate`).
 */
import { sql } from "drizzle-orm";
import {
  boolean, customType, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import {
  DocumentTypeSchema, ExpirySourceSchema, LANGUAGE_CODES, LetterStatusSchema, LetterTypeSchema, PermissionSchema,
  UrgencySchema, VolunteerRoleSchema,
} from "@wilson/contracts";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const languageEnum = pgEnum("language", LANGUAGE_CODES);
export const letterStatusEnum = pgEnum("letter_status", LetterStatusSchema.options as [string, ...string[]]);
export const letterTypeEnum = pgEnum("letter_type", LetterTypeSchema.options as [string, ...string[]]);
export const urgencyEnum = pgEnum("urgency", UrgencySchema.options as [string, ...string[]]);
export const documentTypeEnum = pgEnum("document_type", DocumentTypeSchema.options as [string, ...string[]]);
export const expirySourceEnum = pgEnum("expiry_source", ExpirySourceSchema.options as [string, ...string[]]);
export const roleEnum = pgEnum("volunteer_role", VolunteerRoleSchema.options as [string, ...string[]]);
export const permissionEnum = pgEnum("permission", PermissionSchema.options as [string, ...string[]]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const messageKindEnum = pgEnum("message_kind", ["text", "image", "document", "template", "interactive", "other"]);
export const messageStatusEnum = pgEnum("message_status", ["received", "queued", "sent", "delivered", "read", "failed"]);
export const reminderKindEnum = pgEnum("reminder_kind", ["d30", "d7"]);
export const reminderStatusEnum = pgEnum("reminder_status", ["scheduled", "sent", "cancelled", "failed"]);

/** Conversation state machine snapshot, owned by src/conversation/engine.ts. */
export type ConversationState =
  | { step: "choose_language" }
  | { step: "main_menu" }
  | { step: "await_letter_photo" }
  | { step: "await_document_file" }
  | { step: "confirm_document"; documentId: string }
  | { step: "enter_document_date"; documentId: string }
  | { step: "offer_save_letter"; letterId: string }
  | { step: "confirm_delete_all" };

export const beneficiaries = pgTable("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** HMAC-SHA256(LOOKUP_KEY, wa_id), hex. Used to find the person from a webhook. */
  waIdHash: text("wa_id_hash").notNull().unique(),
  waIdEnc: bytea("wa_id_enc").notNull(),
  /** Last 2 digits only, for the masked label "+33 •• •• •• •• 21". */
  waIdLast2: text("wa_id_last2").notNull(),
  language: languageEnum("language").notNull().default("fr"),
  languageConfirmed: boolean("language_confirmed").notNull().default(false),
  conversationState: jsonb("conversation_state").$type<ConversationState>().notNull().default({ step: "choose_language" }),
  /** Beneficiary DEK wrapped by MASTER_KEY (iv|tag|ciphertext). Destroyed = all data unreadable. */
  wrappedDek: bytea("wrapped_dek"),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Last inbound message: drives WhatsApp's 24 h customer-service window. */
  lastInboundAt: ts("last_inbound_at"),
  archivedAt: ts("archived_at"),
  purgeAt: ts("purge_at"),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  direction: directionEnum("direction").notNull(),
  kind: messageKindEnum("kind").notNull(),
  waMessageId: text("wa_message_id").unique(),
  bodyEnc: bytea("body_enc"),
  /** Sandbox only: inbound media kept as an encrypted blob key so the sandbox page can show it. */
  mediaKey: text("media_key"),
  status: messageStatusEnum("status").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("messages_beneficiary_idx").on(t.beneficiaryId, t.createdAt)]);

export const letters = pgTable("letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  status: letterStatusEnum("status").notNull().default("received"),
  /** Encrypted blob in S3 under tmp/. Nulled when purged. */
  photoKey: text("photo_key"),
  photoMime: text("photo_mime"),
  /** LetterAnalysis JSON, encrypted. */
  analysisEnc: bytea("analysis_enc"),
  frEdited: boolean("fr_edited").notNull().default(false),
  letterType: letterTypeEnum("letter_type"),
  urgency: urgencyEnum("urgency"),
  deadline: date("deadline", { mode: "string" }),
  lowConfidence: boolean("low_confidence").notNull().default(false),
  receivedAt: ts("received_at").notNull().defaultNow(),
  reviewedBy: uuid("reviewed_by").references(() => volunteers.id),
  reviewedAt: ts("reviewed_at"),
  sentAt: ts("sent_at"),
  /** Set when the explanation was held behind the `explanation_ready` template (outside 24 h window). */
  awaitingOptIn: boolean("awaiting_opt_in").notNull().default(false),
}, (t) => [index("letters_status_idx").on(t.status, t.receivedAt)]);

export const letterEvents = pgTable("letter_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  letterId: uuid("letter_id").notNull().references(() => letters.id, { onDelete: "cascade" }),
  volunteerId: uuid("volunteer_id").references(() => volunteers.id),
  action: text("action", { enum: ["analyzed", "edited", "retranslated", "approved", "rejected", "sent", "failed"] }).notNull(),
  note: text("note"),
  at: ts("at").notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull().default("other"),
  labelEnc: bytea("label_enc"),
  expiresAt: date("expires_at", { mode: "string" }),
  expirySource: expirySourceEnum("expiry_source"),
  /** Detection confidence + quote, kept for the volunteer. */
  detection: jsonb("detection").$type<{ confidence: number; quote: string | null; promptVersion: string }>(),
  /** false until the beneficiary confirmed type/date in WhatsApp. Reminders only for confirmed docs. */
  confirmed: boolean("confirmed").notNull().default(false),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
  purgeAt: ts("purge_at"),
}, (t) => [index("documents_expiry_idx").on(t.expiresAt)]);

export const reminders = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  kind: reminderKindEnum("kind").notNull(),
  dueAt: ts("due_at").notNull(),
  status: reminderStatusEnum("status").notNull().default("scheduled"),
  sentAt: ts("sent_at"),
}, (t) => [
  uniqueIndex("reminders_doc_kind_active_idx").on(t.documentId, t.kind).where(sql`status = 'scheduled'`),
  index("reminders_due_idx").on(t.status, t.dueAt),
]);

export const volunteers = pgTable("volunteers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("volunteer"),
  uiLanguage: languageEnum("ui_language").notNull().default("fr"),
  createdAt: ts("created_at").notNull().defaultNow(),
  disabledAt: ts("disabled_at"),
});

/** Per-volunteer overrides on top of ROLE_PERMISSIONS. Empty in the POC. */
export const volunteerPermissions = pgTable("volunteer_permissions", {
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteers.id, { onDelete: "cascade" }),
  permission: permissionEnum("permission").notNull(),
  granted: boolean("granted").notNull(),
}, (t) => [primaryKey({ columns: [t.volunteerId, t.permission] })]);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie token; the token itself is never stored. */
  idHash: text("id_hash").primaryKey(),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteers.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
});

export const accessLog = pgTable("access_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteers.id),
  action: text("action").notNull(), // "letters.photo", "documents.file", "letters.approve"…
  targetId: uuid("target_id"),
  at: ts("at").notNull().defaultNow(),
});

