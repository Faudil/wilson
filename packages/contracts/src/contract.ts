import { oc } from "@orpc/contract";
import { z } from "zod";
import { AssociationRefSchema, AssociationSchema, AssociationSearchInputSchema, InvitationPreviewSchema, InvitationSchema, LoginInputSchema, PasswordResetLinkSchema, PermissionSchema, ResetPasswordInputSchema, SignupInputSchema, TotpCodeSchema, TwoFactorSetupSchema, VolunteerAccountSchema, VolunteerAccountStatusSchema, VolunteerRoleSchema, VolunteerSchema } from "./auth.js";
import { BeneficiaryDetailSchema, BeneficiarySummarySchema, NicknameSchema } from "./beneficiaries.js";
import { CalendarDateSchema, IdSchema, pageOf, PageInputSchema } from "./common.js";
import { DeadlineRowSchema, DocumentSchema, DocumentUpdateSchema } from "./documents.js";
import { ConversationDetailSchema, ConversationSummarySchema, QuickReplyInputSchema, QuickReplySchema } from "./chat.js";
import { KnowledgeHitSchema, KnowledgeSearchInputSchema, KnowledgeSourceIdSchema, KnowledgeSourceSchema } from "./knowledge.js";
import { LanguageSchema } from "./languages.js";
import { BroadcastInputSchema, BroadcastEstimateSchema, BroadcastSchema } from "./broadcasts.js";
import { PlaceInputSchema, PlaceSchema } from "./places.js";
import { LetterDetailSchema, LetterEditSchema, LetterStatusSchema, LetterSummarySchema } from "./letters.js";
import { SandboxMessageSchema, SandboxPhoneSchema, SandboxSendInputSchema } from "./sandbox.js";
import { CaseFileSchema, CaseNoteSchema, CaseTaskSchema, NoteTextSchema, TaskAddSchema, TaskListInputSchema, TaskUpdateSchema } from "./notes.js";
import { DirectoryEntrySchema, SkillsInputSchema, SuggestionSchema, VolunteerSkillSchema, VolunteerSkillsSchema } from "./skills.js";
import {
  BuddyCandidateSchema, BuddyMatchDetailSchema, BuddyMatchSchema, BuddyMatchStatusSchema, BuddyProfileSchema, BuddyProposeInputSchema,
  BuddyReportSchema, BuddyRequestSchema,
} from "./buddies.js";
import { AcceptInputSchema, AppointmentDocumentsSchema, AppointmentListInputSchema, AppointmentSchema, SlotCreateSchema, SlotSchema } from "./appointments.js";
import { GuardStatusSchema, HeldNumbersSchema } from "./guard.js";
import { ApiKeyAddSchema, ApiKeyListSchema, ApiKeySchema, ApiKeyUpdateSchema, UsageBudgetSchema, UsageSetBudgetSchema, UsageSummarySchema } from "./usage.js";

/**
 * The single source of truth for every back-office ⇄ API call.
 * Server: `implement(contract)` in apps/api. Client: `ContractRouterClient<typeof contract>` in apps/backoffice.
 * All procedures require a volunteer session except `auth.login`, `auth.signup`, `auth.searchAssociations`, `auth.verifyEmail`, `auth.resetPassword` and
 * `system.health`.
 */

const base = oc.errors({
  UNAUTHORIZED: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  CONFLICT: { data: z.object({ reason: z.string() }) },
  /** Too many attempts (login, signup): try again after `retryAfterSeconds`. */
  TOO_MANY_REQUESTS: { data: z.object({ retryAfterSeconds: z.number().int() }) },
});

const auth = {
  /** FORBIDDEN = right password but the account is still waiting for an admin's approval. */
  login: base.errors({ TWO_FACTOR_REQUIRED: {} }).input(LoginInputSchema).output(VolunteerSchema),
  /**
   * Public self-signup → pending account, no access until `volunteers.approve`. Always answers `{ ok: true }` for a
   * well-formed request (also when the email is already taken) so it cannot be used to find who volunteers here.
   * FORBIDDEN when VOLUNTEER_SIGNUP=off; CONFLICT { reason: "too_many_pending" } when the pending list is full.
   */
  signup: base.input(SignupInputSchema).output(z.object({ ok: z.literal(true) })),
  /**
   * Public, for the sign-up form: associations matching a name, from the official register (API Recherche
   * d'entreprises, RNA), fetched by the server so the browser talks to nobody else. Empty list when the register
   * is unreachable or ASSOCIATION_SEARCH=off: the form then keeps the typed name as free text.
   */
  searchAssociations: base.input(AssociationSearchInputSchema).output(z.array(AssociationRefSchema)),
  /** Public: what an invite link leads to (association, role), or valid: false when unknown, used, revoked or expired. */
  invitation: base.input(z.object({ token: z.string().min(20).max(100) })).output(InvitationPreviewSchema),
  logout: base.output(z.void()),
  me: base.output(VolunteerSchema),
  setUiLanguage: base.input(z.object({ language: LanguageSchema })).output(VolunteerSchema),
  /** Public: the link in the verification e-mail. Always `{ ok: true }` for a well-formed token (no oracle). */
  verifyEmail: base.input(z.object({ token: z.string().min(20).max(100) })).output(z.object({ ok: z.literal(true) })),
  /**
   * Public: choose a new password with the one-time link an admin created (`volunteers.passwordResetLink`).
   * NOT_FOUND when the link is unknown, used or older than 24 h. Every session of the account is closed.
   */
  resetPassword: base.input(ResetPasswordInputSchema).output(z.object({ ok: z.literal(true) })),
  /** The volunteer closed the first-day welcome cards. */
  finishWelcome: base.output(VolunteerSchema),
  /** New authenticator secret for the logged-in volunteer (not active until twoFactorEnable confirms a code). */
  twoFactorSetup: base.output(TwoFactorSetupSchema),
  twoFactorEnable: base.input(z.object({ code: TotpCodeSchema })).output(VolunteerSchema),
  /** Needs a current code. Admin rights are withheld again afterwards (ADMIN_2FA=required). */
  twoFactorDisable: base.input(z.object({ code: TotpCodeSchema })).output(VolunteerSchema),
};

/** Review queue (copilot mode). Nothing reaches a beneficiary without `approve`. */
const letters = {
  list: base
    .input(PageInputSchema.extend({ status: z.array(LetterStatusSchema).optional() }))
    .output(pageOf(LetterSummarySchema)),
  get: base.input(z.object({ id: IdSchema })).output(LetterDetailSchema),
  /** The original photo, streamed decrypted. Only while it still exists (purged after processing). */
  photo: base.input(z.object({ id: IdSchema })).output(z.file()),
  edit: base.input(LetterEditSchema).output(LetterDetailSchema),
  /** If `frEdited`, regenerates `target` from `fr` (LLM), then queues the WhatsApp send. */
  approve: base.input(z.object({ id: IdSchema })).output(LetterDetailSchema),
  /** Discards the draft; beneficiary receives the fixed "a volunteer will contact you" message. */
  reject: base.input(z.object({ id: IdSchema, note: z.string().max(500).optional() })).output(LetterDetailSchema),
};

const beneficiaries = {
  list: base
    .input(PageInputSchema.extend({ search: z.string().max(40).optional() }))
    .output(pageOf(BeneficiarySummarySchema)),
  get: base.input(z.object({ id: IdSchema })).output(BeneficiaryDetailSchema),
  setLanguage: base.input(z.object({ id: IdSchema, language: LanguageSchema })).output(BeneficiarySummarySchema),
  /** Give the person a first name or nickname so volunteers recognise them (empty = remove). conversations.reply */
  setNickname: base.input(z.object({ id: IdSchema, nickname: NicknameSchema })).output(z.object({ nickname: z.string().nullable() })),
};

/** Saved answers for the conversation composer: everyone who replies reads them, `replies.manage` curates them. */
const quickReplies = {
  list: base.output(z.array(QuickReplySchema)),
  create: base.input(QuickReplyInputSchema).output(QuickReplySchema),
  update: base.input(QuickReplyInputSchema.extend({ id: IdSchema })).output(QuickReplySchema),
  remove: base.input(z.object({ id: IdSchema })).output(z.void()),
};

const documents = {
  /** Upcoming expiries across all beneficiaries, soonest first. */
  deadlines: base
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(60) }))
    .output(z.array(DeadlineRowSchema)),
  file: base.input(z.object({ id: IdSchema })).output(z.file()),
  update: base.input(DocumentUpdateSchema).output(DocumentSchema),
  /** Archives the document (hidden from the beneficiary, reminders cancelled); hard-deleted 30 days later. */
  archive: base.input(z.object({ id: IdSchema })).output(DocumentSchema),
};

/** Only mounted when WHATSAPP_MODE=sandbox. Simulates a phone talking to the bot. */
const sandbox = {
  send: base.input(SandboxSendInputSchema).output(z.void()),
  thread: base.input(z.object({ phone: SandboxPhoneSchema })).output(z.array(SandboxMessageSchema)),
  /** Run the reminder dispatcher as if today were `date` (to test D-30 / D-7 without waiting). */
  runReminders: base.input(z.object({ date: CalendarDateSchema })).output(z.object({ sent: z.number().int() })),
  reset: base.input(z.object({ phone: SandboxPhoneSchema })).output(z.void()),
};

/**
 * Account management: approve self-signups, change roles and permissions, disable accounts.
 * `volunteers.manage` (global admin) acts on every account; `members.manage` (association admin) only on members of
 * their own association, never on other association admins, never up to the admin role or global-only permissions.
 * An account outside the caller's scope answers NOT_FOUND.
 */
const volunteers = {
  list: base.input(z.object({ status: VolunteerAccountStatusSchema.optional() })).output(z.array(VolunteerAccountSchema)),
  /** Pending → active with the chosen role (default responder: conversations only). */
  approve: base.input(z.object({ id: IdSchema, role: VolunteerRoleSchema.default("responder") })).output(VolunteerAccountSchema),
  /** Refuse a pending request: the account row is deleted. */
  reject: base.input(z.object({ id: IdSchema })).output(z.void()),
  setRole: base.input(z.object({ id: IdSchema, role: VolunteerRoleSchema })).output(VolunteerAccountSchema),
  /** Disable (sessions revoked at once) or re-enable an account. Not on yourself. */
  setDisabled: base.input(z.object({ id: IdSchema, disabled: z.boolean() })).output(VolunteerAccountSchema),
  /** Someone lost their phone: remove their authenticator app (they enrol again at next login). Not on yourself. */
  resetTwoFactor: base.input(z.object({ id: IdSchema })).output(VolunteerAccountSchema),
  /**
   * Someone forgot their password: a one-time link (valid 24 h) the admin passes on by hand. Creating a new link
   * cancels the previous one. Not on yourself, not on a pending or disabled account (CONFLICT).
   */
  passwordResetLink: base.input(z.object({ id: IdSchema })).output(PasswordResetLinkSchema),
  /**
   * Replace a person's per-permission overrides on top of their role bundle (granted: false = revoked). Not on
   * yourself, not on a pending account (CONFLICT). Applies on the person's next request.
   */
  setPermissions: base
    .input(z.object({ id: IdSchema, overrides: z.array(z.object({ permission: PermissionSchema, granted: z.boolean() })).max(64) }))
    .output(VolunteerAccountSchema),
};

/** Places for today (shelter, food, showers…): `places.view` to read, `places.manage` to post, edit, remove. */
const places = {
  /** today = open on `date` (default today, Europe/Paris); upcoming = not finished yet; all = including past ones. */
  list: base.input(z.object({ scope: z.enum(["today", "upcoming", "all"]).default("upcoming") })).output(z.array(PlaceSchema)),
  create: base.input(PlaceInputSchema).output(PlaceSchema),
  update: base.input(z.object({ id: IdSchema, place: PlaceInputSchema })).output(PlaceSchema),
  /** Hidden from the bot and the list at once. */
  remove: base.input(z.object({ id: IdSchema })).output(z.void()),
  /** The WhatsApp message a person would get today in `language` (translations are cached). */
  preview: base.input(z.object({ language: LanguageSchema })).output(z.object({ text: z.string() })),
};

/** WhatsApp announcements to people who opted in (menu 6). */
const broadcasts = {
  list: base.output(z.array(BroadcastSchema)),
  /** Recipients and cost if it were sent now. */
  estimate: base.input(z.object({ languages: z.array(LanguageSchema).min(1).nullable().default(null) })).output(BroadcastEstimateSchema),
  create: base.input(BroadcastInputSchema).output(BroadcastSchema),
  /** Drafts only; the author (or `broadcasts.approve`). */
  update: base.input(z.object({ id: IdSchema, broadcast: BroadcastInputSchema })).output(BroadcastSchema),
  /** The text as a person with `language` would read it (translation cached on the draft). */
  preview: base.input(z.object({ id: IdSchema, language: LanguageSchema })).output(z.object({ text: z.string() })),
  /**
   * Approve and send (`broadcasts.approve`). CONFLICT { reason: "own_broadcast" } when four-eyes is on and you wrote
   * it; { reason: "not_draft" }; { reason: "no_recipients" }.
   */
  approve: base.input(z.object({ id: IdSchema })).output(BroadcastSchema),
  /** Drafts only: the author, or `broadcasts.approve`. */
  cancel: base.input(z.object({ id: IdSchema })).output(BroadcastSchema),
};

/** Chatbot conversations: volunteers read them, approve/reject bot drafts, reply themselves, close handoffs. */
const conversations = {
  list: base
    .input(PageInputSchema.extend({ filter: z.enum(["attention", "mine", "all"]).default("attention") }))
    .output(pageOf(ConversationSummarySchema)),
  /** Number of conversations the "attention" list holds: the navigation badge polls this instead of the list. */
  attentionCount: base.output(z.object({ count: z.number().int().nonnegative() })),
  get: base.input(z.object({ beneficiaryId: IdSchema })).output(ConversationDetailSchema),
  /** Send a bot draft, optionally after editing its French version (then re-translated before sending). */
  approveDraft: base.input(z.object({ messageId: IdSchema, textFr: z.string().min(1).max(3000).optional() })).output(ConversationDetailSchema),
  rejectDraft: base.input(z.object({ messageId: IdSchema })).output(ConversationDetailSchema),
  /** Volunteer writes in French; translated to the beneficiary's language by the LLM, footer appended. */
  reply: base.input(z.object({ beneficiaryId: IdSchema, textFr: z.string().min(1).max(3000) })).output(ConversationDetailSchema),
  /**
   * Take the conversation over: the bot stops answering, beneficiary messages wait for a volunteer, and the person is
   * told (fixed text) that a volunteer answers personally. CONFLICT { reason: "assigned" } if someone else holds it,
   * unless `force`. Replying also takes an unassigned conversation over.
   */
  takeOver: base.input(z.object({ beneficiaryId: IdSchema, force: z.boolean().default(false) })).output(ConversationDetailSchema),
  /** Close the handoff / give the conversation back to the bot (clears the assignee). */
  resolve: base.input(z.object({ beneficiaryId: IdSchema })).output(ConversationDetailSchema),
};

/** Knowledge base (RAG) used to ground orientation. */
const knowledge = {
  sources: base.output(z.array(KnowledgeSourceSchema)),
  /** Same retrieval the orientation step uses — lets volunteers check what the AI will see. */
  search: base.input(KnowledgeSearchInputSchema).output(z.array(KnowledgeHitSchema)),
  /** Re-download and re-index one source (admin). Runs in the background. */
  sync: base.input(z.object({ sourceId: KnowledgeSourceIdSchema })).output(z.object({ queued: z.boolean() })),
};

/** Claude API usage and estimated cost (admin, `usage.manage`). Token counts only, never message content. */
const usage = {
  summary: base.output(UsageSummarySchema),
  setBudget: base.input(UsageSetBudgetSchema).output(UsageBudgetSchema),
  /** Claude API keys (e.g. given by donors), each with its own monthly limit. Keys are write-only. */
  listKeys: base.output(ApiKeyListSchema),
  addKey: base.input(ApiKeyAddSchema).output(ApiKeySchema),
  updateKey: base.input(ApiKeyUpdateSchema).output(ApiKeySchema),
  /** Past usage stays counted (without the key name). */
  removeKey: base.input(z.object({ id: IdSchema })).output(z.void()),
};

/**
 * Case notes on a person. Each procedure needs exactly one permission; ownership rules (edit your own note unless
 * notes.moderate) answer FORBIDDEN. Every call is written to access_log.
 */
const notes = {
  /** Notes (newest first) and tasks of one person. notes.view. */
  list: base.input(z.object({ beneficiaryId: IdSchema })).output(CaseFileSchema),
  add: base.input(z.object({ beneficiaryId: IdSchema, text: NoteTextSchema })).output(CaseNoteSchema),
  /** Own note, or anyone's with notes.moderate. */
  edit: base.input(z.object({ id: IdSchema, text: NoteTextSchema })).output(CaseNoteSchema),
  remove: base.input(z.object({ id: IdSchema })).output(z.void()),
};

/**
 * Follow-up tasks with a reminder day ("call back after the OFPRA interview"). Due tasks show on Home and as a badge.
 * CONFLICT { reason: "assignee_cannot_view" } when the assignee is inactive or lacks notes.view.
 */
const tasks = {
  /** Across all persons, for the Tâches screen. notes.view. */
  list: base.input(TaskListInputSchema).output(z.array(CaseTaskSchema)),
  /** My open tasks due today or earlier: the badge polls this. notes.view. */
  dueCount: base.output(z.object({ count: z.number().int().nonnegative() })),
  /** notes.write; an assignee other than yourself also needs tasks.assign. */
  add: base.input(TaskAddSchema).output(CaseTaskSchema),
  /** notes.write. Text: creator or notes.moderate. Assigning to someone else: tasks.assign. */
  update: base.input(TaskUpdateSchema).output(CaseTaskSchema),
};

/** Skills directory and "who can help" suggestions. */
const skills = {
  /** skills.edit_own */
  mine: base.output(VolunteerSkillsSchema),
  updateMine: base.input(SkillsInputSchema).output(VolunteerSkillsSchema),
  /** Active volunteers with at least one language or skill. skills.view */
  directory: base
    .input(z.object({ language: LanguageSchema.optional(), skill: VolunteerSkillSchema.optional() }))
    .output(z.array(DirectoryEntrySchema)),
  /** Volunteers matching a person's language and latest chat intent. skills.view */
  suggest: base.input(z.object({ beneficiaryId: IdSchema })).output(SuggestionSchema),
  /** An admin fills in someone else's profile. volunteers.manage */
  updateFor: base.input(SkillsInputSchema.extend({ volunteerId: IdSchema })).output(VolunteerSkillsSchema),
};

/**
 * French practice buddies. Each procedure names its permission; "own" = the caller is the pairing's volunteer.
 * be_buddy: profile, open requests (anonymised), propose oneself, own pairings (detail with messages, message, skip a
 * session, end, report, see the number only if the beneficiary agreed). manage: every request and pairing, candidates,
 * propose anyone, end any pairing (no messages, no numbers). reports: reports + the reported pairing's messages.
 */
const buddies = {
  myProfile: base.output(BuddyProfileSchema.nullable()),
  saveProfile: base.input(BuddyProfileSchema).output(BuddyProfileSchema),
  /** Waiting requests, oldest first. */
  requests: base.output(z.array(BuddyRequestSchema)),
  candidates: base.input(z.object({ requestId: IdSchema })).output(z.array(BuddyCandidateSchema)),
  /** Sends the proposal to the beneficiary on WhatsApp. CONFLICT: request not waiting, already proposed, volunteer full / not a buddy. */
  propose: base.input(BuddyProposeInputSchema).output(BuddyMatchSchema),
  /** The caller's own pairings (proposed, active, suspended), then the 20 most recent ended ones. */
  mine: base.output(z.array(BuddyMatchSchema)),
  all: base.input(z.object({ status: BuddyMatchStatusSchema.optional() })).output(z.array(BuddyMatchSchema)),
  get: base.input(z.object({ id: IdSchema })).output(BuddyMatchDetailSchema),
  /** Own pairing only; relayed on WhatsApp with the buddy's first name. Active pairings only. */
  sendMessage: base.input(z.object({ matchId: IdSchema, text: z.string().trim().min(1).max(1000) })).output(BuddyMatchDetailSchema),
  /** Cancel one upcoming session (own pairing); the beneficiary is told. */
  skipSession: base.input(z.object({ sessionId: IdSchema })).output(BuddyMatchDetailSchema),
  end: base.input(z.object({ matchId: IdSchema })).output(BuddyMatchSchema),
  /** Own pairing; FORBIDDEN unless the beneficiary agreed and the pairing is active. Logged. */
  contact: base.input(z.object({ matchId: IdSchema })).output(z.object({ phone: z.string() })),
  /** Own pairing: report a problem. The pairing is paused at once. */
  report: base.input(z.object({ matchId: IdSchema, text: z.string().trim().min(3).max(2000) })).output(BuddyMatchSchema),
  reports: base.input(z.object({ status: z.enum(["open", "closed"]).default("open") })).output(z.array(BuddyReportSchema)),
  resolveReport: base
    .input(z.object({ id: IdSchema, action: z.enum(["resume", "end"]), note: z.string().trim().max(500).optional() }))
    .output(BuddyReportSchema),
  /** Counts for the navigation badge (zeros for what the caller may not see). */
  counts: base.output(z.object({ waiting: z.number().int(), openReports: z.number().int() })),
};

/**
 * Rendez-vous: accompaniment to appointments and form-filling sessions (see appointments.ts). Every procedure checks
 * its own `appointments.*` permission; holding an appointment is checked on top for release/done/documents.
 */
const appointments = {
  list: base.input(AppointmentListInputSchema).output(z.array(AppointmentSchema)),
  /** Navigation badge / home tile: requests waiting for a volunteer, and mine in the next 7 days. */
  counts: base.output(z.object({ open: z.number().int().nonnegative(), mineSoon: z.number().int().nonnegative() })),
  /** CONFLICT { reason: "taken" } when someone accepted first; { reason: "time_required" } for a form session without a time. */
  accept: base.input(AcceptInputSchema).output(AppointmentSchema),
  /** Give it back: the person is told, and the request is open again for another volunteer. Holder or manager. */
  release: base.input(z.object({ id: IdSchema })).output(AppointmentSchema),
  /** The session took place. Ends access to the person's documents. Holder or manager. */
  complete: base.input(z.object({ id: IdSchema })).output(AppointmentSchema),
  /** Cancel for good (`appointments.manage`); the person is told. */
  cancel: base.input(z.object({ id: IdSchema })).output(AppointmentSchema),
  /** The person's saved documents, for the holder of a form session the person consented to (logged). */
  documents: base.input(z.object({ id: IdSchema })).output(AppointmentDocumentsSchema),
  documentFile: base.input(z.object({ id: IdSchema, documentId: IdSchema })).output(z.file()),
  /** Upcoming form-filling slots: mine (`appointments.slots`) or everyone's (`appointments.manage`). */
  slots: base.input(z.object({ scope: z.enum(["mine", "all"]).default("mine") })).output(z.array(SlotSchema)),
  addSlot: base.input(SlotCreateSchema).output(SlotSchema),
  /** Only a slot nobody booked yet; your own, or anyone's with `appointments.manage`. */
  removeSlot: base.input(z.object({ id: IdSchema })).output(z.void()),
};

/**
 * WhatsApp numbers held by the flood guard, and blocked numbers (`numbers.moderate`). Every call is logged.
 * Releasing tells the person (fixed text) that they can write again; blocking is silent.
 */
const numbers = {
  list: base.input(z.object({ status: GuardStatusSchema.exclude(["none"]).default("quarantined") })).output(HeldNumbersSchema),
  /** Held numbers waiting for a decision: the navigation badge polls this. */
  heldCount: base.output(z.object({ count: z.number().int().nonnegative(), floodMode: z.boolean() })),
  release: base.input(z.object({ beneficiaryId: IdSchema })).output(z.void()),
  /** Releases every number held because of a global flood (once the wave is over). */
  releaseAllGlobal: base.output(z.object({ released: z.number().int().nonnegative() })),
  block: base.input(z.object({ beneficiaryId: IdSchema })).output(z.void()),
  unblock: base.input(z.object({ beneficiaryId: IdSchema })).output(z.void()),
};

/** Associations (global admin, `associations.manage`). */
const associations = {
  list: base.output(z.array(AssociationSchema)),
  /** From the official register (siren/rna) or a typed name. CONFLICT { reason: "exists" } on a duplicate SIREN/RNA. */
  create: base.input(AssociationRefSchema).output(AssociationSchema),
  /** Put a volunteer in an association (or none). Removing them from an association also removes its admin flag. */
  setMember: base.input(z.object({ volunteerId: IdSchema, associationId: IdSchema.nullable() })).output(VolunteerAccountSchema),
  /** Name or remove an association admin. Naming also moves the volunteer into the association. Active accounts only. */
  setAdmin: base.input(z.object({ volunteerId: IdSchema, associationId: IdSchema, admin: z.boolean() })).output(VolunteerAccountSchema),
};

/**
 * Invite links (`members.manage` for your own association, `volunteers.manage` for any). The token is returned once,
 * in the link; only its hash is stored. Valid 7 days, single use. Opening it signs the person up already approved.
 */
const invitations = {
  list: base.output(z.array(InvitationSchema)),
  create: base
    .input(z.object({
      role: VolunteerRoleSchema.default("responder"),
      label: z.string().trim().max(80).optional(),
      /** Global admins pick the association (null = none); association admins always invite into their own. */
      associationId: IdSchema.nullable().optional(),
    }))
    .output(z.object({ invitation: InvitationSchema, token: z.string() })),
  revoke: base.input(z.object({ id: IdSchema })).output(InvitationSchema),
};

const system = {
  health: oc.output(z.object({ ok: z.boolean(), mode: z.enum(["sandbox", "meta"]), llm: z.enum(["anthropic", "fake"]), chat: z.enum(["review", "auto"]).optional(), signup: z.boolean().optional(), emailVerification: z.boolean().optional() })),
};

export const contract = { auth, letters, beneficiaries, quickReplies, documents, sandbox, knowledge, conversations, volunteers, associations, invitations, usage, notes, tasks, skills, places, broadcasts, buddies, appointments, numbers, system };
export type Contract = typeof contract;
