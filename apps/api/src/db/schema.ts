/**
 * Drizzle schema — the integration point shared by every batch.
 * Columns suffixed `Enc` hold AES-256-GCM ciphertext under the beneficiary DEK (see src/crypto/keys.ts).
 * Change this file only through a reviewed migration (`bun run db:generate`).
 */
import type { ChannelId } from "../channels/types.js";
import { sql } from "drizzle-orm";
import type { LanguageCode } from "@wilson/contracts";
import {
  type AnyPgColumn, boolean, customType, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import {
  BroadcastStatusSchema, DocumentTypeSchema, ExpirySourceSchema, GuardReasonSchema, GuardStatusSchema, HelpKindSchema, HelpStatusSchema, HelpTopicSchema, LANGUAGE_CODES, PlaceKindSchema, LetterStatusSchema, LetterTypeSchema, PermissionSchema,
  type BuddySlot, type BuddyWindow, BuddyMatchStatusSchema, BuddyModePreferenceSchema, BuddyModeSchema, BuddyWindowSchema,
  TaskStatusSchema, UrgencySchema, VOLUNTEER_SKILLS, VolunteerRoleSchema,
} from "@wilson/contracts";

export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  // node-postgres returns Buffer, PGlite (local mode) returns Uint8Array: normalise to Buffer.
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

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
export const messageAuthorEnum = pgEnum("message_author", ["beneficiary", "bot", "volunteer", "system"]);
export const chatStateEnum = pgEnum("chat_state", ["received", "draft", "sent", "rejected"]);
export const chatIntentEnum = pgEnum("chat_intent", ["info", "legal", "urgent", "human", "letter", "document", "smalltalk", "out_of_scope", "places"]);
export const placeKindEnum = pgEnum("place_kind", PlaceKindSchema.options as [string, ...string[]]);
export const broadcastStatusEnum = pgEnum("broadcast_status", BroadcastStatusSchema.options as [string, ...string[]]);
export const recipientStatusEnum = pgEnum("broadcast_recipient_status", ["queued", "awaiting_reply", "sent", "failed", "skipped"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["bot", "pending_review", "needs_human", "with_volunteer", "resolved"]);
export const reminderKindEnum = pgEnum("reminder_kind", ["d30", "d7"]);
export const knowledgeSourceEnum = pgEnum("knowledge_source", ["service_public", "annuaire", "association", "watizat"]);
export const knowledgeKindEnum = pgEnum("knowledge_kind", ["procedure", "contact", "guide"]);
export const volunteerSkillEnum = pgEnum("volunteer_skill", VOLUNTEER_SKILLS as unknown as [string, ...string[]]);
export const taskStatusEnum = pgEnum("task_status", TaskStatusSchema.options as [string, ...string[]]);
/** Typed enum values (casting zod options to string[] would erase the literal types of these columns). */
const tuple = <T extends string>(xs: readonly T[]) => xs as unknown as [T, ...T[]];
export const buddyWindowEnum = pgEnum("buddy_window", tuple(BuddyWindowSchema.options));
export const buddyModeEnum = pgEnum("buddy_mode", tuple(BuddyModeSchema.options));
export const buddyModePrefEnum = pgEnum("buddy_mode_pref", tuple(BuddyModePreferenceSchema.options));
export const buddyRequestStatusEnum = pgEnum("buddy_request_status", ["waiting", "matched", "cancelled"]);
export const buddyMatchStatusEnum = pgEnum("buddy_match_status", tuple(BuddyMatchStatusSchema.options));
export const buddySessionStatusEnum = pgEnum("buddy_session_status", ["scheduled", "cancelled", "done"]);
export const buddyPartyEnum = pgEnum("buddy_party", ["beneficiary", "volunteer", "coordinator"]);
export const guardStatusEnum = pgEnum("guard_status", GuardStatusSchema.options as [string, ...string[]]);
export const guardReasonEnum = pgEnum("guard_reason", GuardReasonSchema.options as [string, ...string[]]);
export const reminderStatusEnum = pgEnum("reminder_status", ["scheduled", "sent", "cancelled", "failed"]);
export const helpKindEnum = pgEnum("help_kind", HelpKindSchema.options as [string, ...string[]]);
export const helpTopicEnum = pgEnum("help_topic", HelpTopicSchema.options as [string, ...string[]]);
export const helpStatusEnum = pgEnum("help_status", HelpStatusSchema.options as [string, ...string[]]);
export const helpReminderKindEnum = pgEnum("help_reminder_kind", ["d1", "h2"]);

/** Conversation state machine snapshot, owned by src/conversation/engine.ts. */
export type ConversationState =
  /** pendingFile: a photo/PDF sent before the language was chosen, processed as a letter right after. */
  | { step: "choose_language"; pendingFile?: { mediaId: string; mime: string } }
  | { step: "main_menu" }
  | { step: "await_letter_photo" }
  | { step: "await_document_file" }
  | { step: "confirm_document"; documentId: string }
  | { step: "enter_document_date"; documentId: string }
  | { step: "offer_save_letter"; letterId: string }
  | { step: "confirm_delete_all" }
  /** Menu 6: "receive the association's announcements? 1 yes 2 no". */
  | { step: "announcements" }
  // — Rendez-vous with a volunteer (menu 8, src/appointments/flow.ts). Personal details live encrypted in the
  //   help_requests row (status draft while typed), never in this plain-JSON state. —
  | { step: "help_menu" }
  | { step: "help_topic"; kind: "accompaniment" | "form_session" }
  | { step: "help_datetime"; requestId: string }
  | { step: "help_city"; requestId: string }
  | { step: "help_confirm"; requestId: string }
  /** slotIds[i] is option i+1 of the list the person saw. */
  | { step: "help_slot"; requestId: string; slotIds: string[] }
  | { step: "help_consent"; requestId: string; slotId?: string }
  | { step: "help_list"; requestIds: string[] }
  | { step: "help_cancel"; requestId: string }
  /** Menu 5 was answered: a shared location or a typed address lists the places nearest to it (nothing is stored). */
  | { step: "nearby" }
  /** Free-form chat ("ask a question"); any non-menu text also goes to the chatbot. */
  | { step: "chat" }
  // — French practice buddies (conversation/buddyFlow.ts) —
  | { step: "buddy_when" }
  | { step: "buddy_how"; window: BuddyWindow }
  | { step: "buddy_waiting"; requestId: string }
  | { step: "buddy_proposal"; matchId: string }
  /** afterAccept: the person just said yes to the proposal (the welcome text follows the answer). */
  | { step: "buddy_consent"; matchId: string; afterAccept?: boolean }
  | { step: "buddy_menu"; matchId: string }
  | { step: "buddy_write"; matchId: string }
  | { step: "buddy_stop"; matchId: string }
  | { step: "buddy_report"; matchId: string };

export const beneficiaries = pgTable("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Channel the person writes on (src/channels): whatsapp, later telegram, sms… Text, not an enum, so a new channel
   * needs no migration. The `wa_id_*` columns hold the address on that channel (phone, BSUID, chat id).
   */
  channel: text("channel").$type<ChannelId>().notNull().default("whatsapp"),
  /**
   * HMAC-SHA256(LOOKUP_KEY, address), hex. Used to find the person from a webhook. WhatsApp hashes the bare wa_id;
   * other channels hash `<channel>:<address>`, so the same digits on two channels are two people.
   */
  waIdHash: text("wa_id_hash").notNull().unique(),
  waIdEnc: bytea("wa_id_enc").notNull(),
  /** Last 2 digits only, for the masked label "+33 •• •• •• •• 21". */
  waIdLast2: text("wa_id_last2").notNull(),
  /**
   * HMAC-SHA256(LOOKUP_KEY, BSUID), hex: WhatsApp's business-scoped user id, sent with every message since 2026.
   * Finds the person when WhatsApp hides their phone number (usernames); `wa_id_*` then hold the BSUID itself.
   */
  userIdHash: text("user_id_hash"),
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
  /** Chatbot handoff state, drives the Conversations screen. */
  chatStatus: conversationStatusEnum("chat_status").notNull().default("bot"),
  /** Volunteer who took the conversation over (chat_status = with_volunteer). The bot stays silent meanwhile. */
  chatAssigneeId: uuid("chat_assignee_id").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  /** Flood guard (src/whatsapp/guard.ts): quarantined = held for a volunteer, blocked = every message dropped. */
  guardStatus: guardStatusEnum("guard_status").notNull().default("none"),
  guardReason: guardReasonEnum("guard_reason"),
  guardAt: ts("guard_at"),
  /** Volunteer who blocked / released the number (null when the guard acted on its own). */
  guardBy: uuid("guard_by").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  /** When the person said yes to announcements (menu 6); null = no announcements (opt-in only, WhatsApp policy). */
  announcementsOptInAt: ts("announcements_opt_in_at"),
}, (t) => [
  index("beneficiaries_guard_idx").on(t.guardStatus, t.guardAt).where(sql`${t.guardStatus} <> 'none'`),
  index("beneficiaries_user_id_hash_idx").on(t.userIdHash),
]);

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
  // — chatbot (null for menu/system traffic of the letter & document flows) —
  author: messageAuthorEnum("author"),
  chatState: chatStateEnum("chat_state"),
  intent: chatIntentEnum("intent"),
  /** French version for volunteers, encrypted. */
  textFrEnc: bytea("text_fr_enc"),
  sources: jsonb("sources").$type<{ chunkId: string; sourceId: string; title: string; url: string | null }[]>(),
  volunteerId: uuid("volunteer_id").references(() => volunteers.id),
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
}, (t) => [
  index("letters_status_idx").on(t.status, t.receivedAt),
  // A person's letters (beneficiary page, "where is my letter?" in the chat, purge).
  index("letters_beneficiary_idx").on(t.beneficiaryId, t.receivedAt),
]);

export const letterEvents = pgTable("letter_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  letterId: uuid("letter_id").notNull().references(() => letters.id, { onDelete: "cascade" }),
  volunteerId: uuid("volunteer_id").references(() => volunteers.id),
  action: text("action", { enum: ["analyzed", "edited", "retranslated", "approved", "rejected", "sent", "failed"] }).notNull(),
  note: text("note"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("letter_events_letter_idx").on(t.letterId, t.at)]);

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
}, (t) => [
  index("documents_expiry_idx").on(t.expiresAt),
  // A person's documents (beneficiary page, document flow in WhatsApp, purge).
  index("documents_beneficiary_idx").on(t.beneficiaryId),
]);

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

/** Associations working on this instance. Created by a global admin (associations.manage). */
export const associations = pgTable("associations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** From the official register when picked there (API Recherche d'entreprises), else null. */
  siren: text("siren").unique(),
  rna: text("rna").unique(),
  city: text("city"),
  createdBy: uuid("created_by").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const volunteers = pgTable("volunteers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("volunteer"),
  uiLanguage: languageEnum("ui_language").notNull().default("fr"),
  createdAt: ts("created_at").notNull().defaultNow(),
  disabledAt: ts("disabled_at"),
  /** Self-signup waiting for an admin: cannot log in, has no session, sees nothing. */
  pendingApproval: boolean("pending_approval").notNull().default(false),
  /** Free text from the signup form ("how would you like to help?"), for the approving admin. */
  signupNote: text("signup_note"),
  approvedAt: ts("approved_at"),
  approvedBy: uuid("approved_by").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  /** False only for self-signups that have not clicked the e-mail link yet (when SMTP_URL is set). */
  emailVerified: boolean("email_verified").notNull().default(true),
  /** SHA-256 of the e-mail verification token, and its expiry. */
  emailTokenHash: text("email_token_hash"),
  emailTokenExpiresAt: ts("email_token_expires_at"),
  /** TOTP secret, encrypted under its own DEK (wrapped by MASTER_KEY). Enabled once a first code was confirmed. */
  totpSecretEnc: bytea("totp_secret_enc"),
  totpWrappedDek: bytea("totp_wrapped_dek"),
  totpEnabledAt: ts("totp_enabled_at"),
  /** Last accepted 30-second step: a code cannot be used twice. */
  totpLastStep: integer("totp_last_step"),
  /** Association the volunteer is with (sign-up form). siren/rna only when picked from the official register. */
  associationName: text("association_name"),
  associationSiren: text("association_siren"),
  associationRna: text("association_rna"),
  associationCity: text("association_city"),
  /** Association the volunteer belongs to (null = managed by global admins only). */
  associationId: uuid("association_id").references((): AnyPgColumn => associations.id, { onDelete: "set null" }),
  /** Association admin: gets members.manage, limited by the server to members of associationId. */
  associationAdmin: boolean("association_admin").notNull().default(false),
});

/** Single-use invite links created by an association admin (or a global admin). Only the token hash is stored. */
export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  associationId: uuid("association_id").references(() => associations.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(), // no DB default: an enum value added in the same migration batch cannot be used before commit
  /** Free label to recognise the invite in the list ("Fatima, permanence du mardi"). */
  label: text("label"),
  createdBy: uuid("created_by").notNull().references(() => volunteers.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: uuid("used_by").references(() => volunteers.id, { onDelete: "set null" }),
  revokedAt: ts("revoked_at"),
});

/**
 * Rendez-vous: a beneficiary asks a volunteer to come along to an appointment, or to fill in a form together.
 * `cityEnc` / `meetingPointEnc` are under the beneficiary DEK (crypto-shredded with the rest of their data).
 */
export const helpRequests = pgTable("help_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  kind: helpKindEnum("kind").notNull(),
  topic: helpTopicEnum("topic").notNull(),
  status: helpStatusEnum("status").notNull().default("draft"),
  /** Appointment time (accompaniment: given by the person; form session: the slot or the volunteer's proposal). */
  startsAt: ts("starts_at"),
  durationMin: integer("duration_min").notNull().default(60),
  cityEnc: bytea("city_enc"),
  meetingPointEnc: bytea("meeting_point_enc"),
  volunteerId: uuid("volunteer_id").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  /** The slot this form session was booked on. */
  slotId: uuid("slot_id").references((): AnyPgColumn => helpSlots.id, { onDelete: "set null" }),
  /** The person agreed that the volunteer opens their saved documents for this session (form sessions only). */
  documentsConsent: boolean("documents_consent").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  acceptedAt: ts("accepted_at"),
  closedAt: ts("closed_at"),
}, (t) => [
  index("help_requests_status_idx").on(t.status, t.startsAt),
  index("help_requests_beneficiary_idx").on(t.beneficiaryId),
  index("help_requests_volunteer_idx").on(t.volunteerId, t.startsAt),
]);

/** Form-filling slots a volunteer publishes; people book them on WhatsApp. `place` is the venue, not personal data. */
export const helpSlots = pgTable("help_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  volunteerId: uuid("volunteer_id").notNull().references((): AnyPgColumn => volunteers.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  place: text("place").notNull(),
  /** Set when booked (claimed atomically: `where request_id is null`). */
  requestId: uuid("request_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("help_slots_starts_idx").on(t.startsAt)]);

/** WhatsApp reminders to the person: the day before (d1) and 2 hours before (h2). */
export const helpReminders = pgTable("help_reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => helpRequests.id, { onDelete: "cascade" }),
  kind: helpReminderKindEnum("kind").notNull(),
  dueAt: ts("due_at").notNull(),
  status: reminderStatusEnum("status").notNull().default("scheduled"),
  sentAt: ts("sent_at"),
}, (t) => [
  uniqueIndex("help_reminders_req_kind_active_idx").on(t.requestId, t.kind).where(sql`status = 'scheduled'`),
  index("help_reminders_due_idx").on(t.status, t.dueAt),
]);

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

/** Case notes on a person, written by volunteers. Text encrypted under the beneficiary DEK (crypto-shredded with them). */
export const caseNotes = pgTable("case_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => volunteers.id, { onDelete: "set null" }),
  bodyEnc: bytea("body_enc").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  editedAt: ts("edited_at"),
}, (t) => [index("case_notes_beneficiary_idx").on(t.beneficiaryId, t.createdAt)]);

/** Follow-up tasks on a person, with a reminder day. Text encrypted under the beneficiary DEK. */
export const caseTasks = pgTable("case_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => volunteers.id, { onDelete: "set null" }),
  /** null = unassigned (anyone can pick it up). */
  assigneeId: uuid("assignee_id").references(() => volunteers.id, { onDelete: "set null" }),
  textEnc: bytea("text_enc").notNull(),
  /** Reminder day, Europe/Paris calendar date. */
  dueOn: date("due_on", { mode: "string" }),
  status: taskStatusEnum("status").notNull().default("open"),
  createdAt: ts("created_at").notNull().defaultNow(),
  doneAt: ts("done_at"),
  doneBy: uuid("done_by").references(() => volunteers.id, { onDelete: "set null" }),
}, (t) => [
  index("case_tasks_beneficiary_idx").on(t.beneficiaryId, t.createdAt),
  // "My tasks" and the due badge.
  index("case_tasks_assignee_idx").on(t.assigneeId, t.status, t.dueOn),
]);

/** Skills directory: one row per volunteer who filled in their profile. About volunteers, not beneficiaries: clear text. */
export const volunteerSkills = pgTable("volunteer_skills", {
  volunteerId: uuid("volunteer_id").primaryKey().references(() => volunteers.id, { onDelete: "cascade" }),
  /** Languages they can speak with people in (French assumed). */
  languages: languageEnum("languages").array().notNull().default(sql`'{}'`),
  skills: volunteerSkillEnum("skills").array().notNull().default(sql`'{}'`),
  note: text("note"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * One row per Claude API call (each repair retry counts). Token counts from the API's `usage` block and the
 * estimated cost; no prompt, no reply, no name or phone. `beneficiaryId` only groups calls by conversation and is
 * cleared when the person's data is purged.
 */
export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: ts("at").notNull().defaultNow(),
  task: text("task").notNull(), // UsageTask (prompt name)
  model: text("model").notNull(),
  language: languageEnum("language"),
  beneficiaryId: uuid("beneficiary_id").references(() => beneficiaries.id, { onDelete: "set null" }),
  /** Which donated key paid for it; null = the server key (ANTHROPIC_API_KEY) or a deleted key. */
  apiKeyId: uuid("api_key_id").references((): AnyPgColumn => llmApiKeys.id, { onDelete: "set null" }),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  /** Estimated cost in millionths of a USD; null = model not in the price list. */
  costMicroUsd: integer("cost_micro_usd"),
}, (t) => [index("llm_usage_at_idx").on(t.at)]);

/**
 * Claude API keys added by admins (e.g. given by donors), each with its own monthly limit. Calls use the oldest
 * active key that still has budget, then the next one, then the server key. The key itself is encrypted
 * (own DEK wrapped by MASTER_KEY) and never sent back to the back-office: only its last 4 characters.
 */
export const llmApiKeys = pgTable("llm_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  wrappedDek: bytea("wrapped_dek").notNull(),
  keyEnc: bytea("key_enc").notNull(),
  keyLast4: text("key_last4").notNull(),
  /** USD cents per calendar month; null = no limit of its own. */
  monthlyLimitCents: integer("monthly_limit_cents"),
  disabledAt: ts("disabled_at"),
  /** Last error from the API with this key (invalid key, no credit…): the key is skipped for a while. */
  lastError: text("last_error"),
  lastErrorAt: ts("last_error_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => volunteers.id, { onDelete: "set null" }),
});

/** Single row (id = 1): the monthly Claude budget set by an admin in the back-office. */
export const llmBudget = pgTable("llm_budget", {
  id: integer("id").primaryKey().default(1),
  /** Monthly limit in USD cents; null = no limit. */
  monthlyLimitCents: integer("monthly_limit_cents"),
  hardStop: boolean("hard_stop").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => volunteers.id, { onDelete: "set null" }),
});

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Knowledge base (RAG). Public, non-personal content only — never beneficiary data. */
export const knowledgeSources = pgTable("knowledge_sources", {
  id: knowledgeSourceEnum("id").primaryKey(),
  /** Admin override; null = adapter default (`enabledByDefault`). */
  enabled: boolean("enabled"),
  lastSyncAt: ts("last_sync_at"),
  lastError: text("last_error"),
});

export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: knowledgeSourceEnum("source_id").notNull(),
  /** Stable id inside the source (fiche id + section, annuaire id…), used to upsert on re-sync. */
  externalId: text("external_id").notNull(),
  kind: knowledgeKindEnum("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  /** INSEE département code for local contacts; null = national. */
  department: text("department"),
  /** Plain text, ≤ ~1500 chars per chunk. French. */
  text: text("text").notNull(),
  /** Source-provided last update, if any. */
  sourceUpdatedAt: ts("source_updated_at"),
  syncedAt: ts("synced_at").notNull().defaultNow(),
  /** French full-text index over title (weight A) + text (weight B). */
  tsv: tsvector("tsv").generatedAlwaysAs(
    sql`setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(text, '')), 'B')`,
  ),
}, (t) => [
  uniqueIndex("knowledge_chunks_source_ext_idx").on(t.sourceId, t.externalId),
  index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
  index("knowledge_chunks_dept_idx").on(t.department),
]);

/**
 * Places for the day posted by volunteers (115, food distributions, showers…). Public information, so in clear.
 * `translations` caches the name/details per language (cleared on edit) so each language is translated once.
 */
export const places = pgTable("places", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: placeKindEnum("kind").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  details: text("details"),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }),
  /** ISO weekdays 1..7; empty = every day. */
  weekdays: integer("weekdays").array().notNull().default(sql`'{}'::integer[]`),
  opensAt: text("opens_at"),
  closesAt: text("closes_at"),
  /** Where `address` is, found with OpenStreetMap when the place is saved (null: no address, or not found). */
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  translations: jsonb("translations").$type<Partial<Record<LanguageCode, { name: string; details: string | null }>>>().notNull().default({}),
  createdBy: uuid("created_by").references(() => volunteers.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => volunteers.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  removedAt: ts("removed_at"),
}, (t) => [index("places_active_idx").on(t.removedAt, t.startsOn)]);

/** Announcements (WhatsApp broadcasts) to beneficiaries who opted in. The text is the association's, not personal. */
export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  textFr: text("text_fr").notNull(),
  /** null = every language. */
  languages: languageEnum("languages").array(),
  status: broadcastStatusEnum("status").notNull().default("draft"),
  /** Cached translations of textFr (cleared when the draft is edited). */
  translations: jsonb("translations").$type<Partial<Record<LanguageCode, string>>>().notNull().default({}),
  /** Estimate taken at approval (recipients, cost). */
  estimate: jsonb("estimate").$type<import("@wilson/contracts").BroadcastEstimate>(),
  createdBy: uuid("created_by").references(() => volunteers.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  approvedBy: uuid("approved_by").references(() => volunteers.id, { onDelete: "set null" }),
  approvedAt: ts("approved_at"),
  sentAt: ts("sent_at"),
  cancelledAt: ts("cancelled_at"),
}, (t) => [index("broadcasts_created_idx").on(t.createdAt)]);

/** One row per person and announcement: idempotent sending, and the text held behind the template until they reply. */
export const broadcastRecipients = pgTable("broadcast_recipients", {
  broadcastId: uuid("broadcast_id").notNull().references(() => broadcasts.id, { onDelete: "cascade" }),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  status: recipientStatusEnum("status").notNull().default("queued"),
  /** The announcement template was used (outside the 24 h window): counted in the cost. */
  viaTemplate: boolean("via_template").notNull().default(false),
  sentAt: ts("sent_at"),
  error: text("error"),
}, (t) => [
  primaryKey({ columns: [t.broadcastId, t.beneficiaryId] }),
  index("broadcast_recipients_beneficiary_idx").on(t.beneficiaryId, t.status),
]);

// ---------------------------------------------------------------- French practice buddies

/**
 * A volunteer's buddy profile. Spoken languages live here for now; once the skills directory (volunteer_skills)
 * is merged, matching should read its `languages` column instead.
 */
export const buddyProfiles = pgTable("buddy_profiles", {
  volunteerId: uuid("volunteer_id").primaryKey().references(() => volunteers.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  languages: languageEnum("languages").array().notNull().default(sql`'{}'`),
  slots: jsonb("slots").$type<BuddySlot[]>().notNull().default([]),
  modes: buddyModeEnum("modes").array().notNull(),
  maxBuddies: integer("max_buddies").notNull().default(1),
  /** Public place / association premises; never a home address. Shown to the beneficiary. */
  meetPlace: text("meet_place"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const buddyRequests = pgTable("buddy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  windows: buddyWindowEnum("windows").array().notNull(),
  mode: buddyModePrefEnum("mode").notNull(),
  status: buddyRequestStatusEnum("status").notNull().default("waiting"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("buddy_requests_status_idx").on(t.status, t.createdAt),
  // One open request per person.
  uniqueIndex("buddy_requests_one_waiting_idx").on(t.beneficiaryId).where(sql`status = 'waiting'`),
]);

export const buddyMatches = pgTable("buddy_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => buddyRequests.id, { onDelete: "cascade" }),
  beneficiaryId: uuid("beneficiary_id").notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteers.id, { onDelete: "cascade" }),
  status: buddyMatchStatusEnum("status").notNull().default("proposed"),
  weekday: integer("weekday").notNull(),
  time: text("time").notNull(),
  mode: buddyModeEnum("mode").notNull(),
  place: text("place"),
  /** Beneficiary said yes on WhatsApp to share their number with this volunteer. Revocable. */
  contactShared: boolean("contact_shared").notNull().default(false),
  proposedBy: uuid("proposed_by").references((): AnyPgColumn => volunteers.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  acceptedAt: ts("accepted_at"),
  endedAt: ts("ended_at"),
  endedBy: buddyPartyEnum("ended_by"),
}, (t) => [
  index("buddy_matches_volunteer_idx").on(t.volunteerId, t.status),
  index("buddy_matches_beneficiary_idx").on(t.beneficiaryId, t.status),
]);

export const buddySessions = pgTable("buddy_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => buddyMatches.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  status: buddySessionStatusEnum("status").notNull().default("scheduled"),
  cancelledBy: buddyPartyEnum("cancelled_by"),
  remindedAt: ts("reminded_at"),
}, (t) => [
  uniqueIndex("buddy_sessions_match_start_idx").on(t.matchId, t.startsAt),
  index("buddy_sessions_due_idx").on(t.status, t.startsAt),
]);

/** What the two people wrote to each other through Wilson. Encrypted with the beneficiary's DEK (crypto-shredded with them). */
export const buddyMessages = pgTable("buddy_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => buddyMatches.id, { onDelete: "cascade" }),
  author: buddyPartyEnum("author").notNull(),
  bodyEnc: bytea("body_enc").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("buddy_messages_match_idx").on(t.matchId, t.createdAt)]);

/** A problem reported by either side. Text encrypted with the beneficiary's DEK. The pairing is suspended meanwhile. */
export const buddyReports = pgTable("buddy_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => buddyMatches.id, { onDelete: "cascade" }),
  by: buddyPartyEnum("by").notNull(),
  textEnc: bytea("text_enc").notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  createdAt: ts("created_at").notNull().defaultNow(),
  resolution: text("resolution", { enum: ["resumed", "ended"] }),
  noteEnc: bytea("note_enc"),
  handledBy: uuid("handled_by").references(() => volunteers.id, { onDelete: "set null" }),
  handledAt: ts("handled_at"),
}, (t) => [index("buddy_reports_status_idx").on(t.status, t.createdAt)]);
