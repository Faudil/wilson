import { oc } from "@orpc/contract";
import { z } from "zod";
import { LoginInputSchema, SignupInputSchema, TotpCodeSchema, TwoFactorSetupSchema, VolunteerAccountSchema, VolunteerAccountStatusSchema, VolunteerRoleSchema, VolunteerSchema } from "./auth.js";
import { BeneficiaryDetailSchema, BeneficiarySummarySchema } from "./beneficiaries.js";
import { CalendarDateSchema, IdSchema, pageOf, PageInputSchema } from "./common.js";
import { DeadlineRowSchema, DocumentSchema, DocumentUpdateSchema } from "./documents.js";
import { ConversationDetailSchema, ConversationSummarySchema } from "./chat.js";
import { KnowledgeHitSchema, KnowledgeSearchInputSchema, KnowledgeSourceIdSchema, KnowledgeSourceSchema } from "./knowledge.js";
import { LanguageSchema } from "./languages.js";
import { LetterDetailSchema, LetterEditSchema, LetterStatusSchema, LetterSummarySchema } from "./letters.js";
import { SandboxMessageSchema, SandboxPhoneSchema, SandboxSendInputSchema } from "./sandbox.js";
import { CaseFileSchema, CaseNoteSchema, CaseTaskSchema, NoteTextSchema, TaskAddSchema, TaskListInputSchema, TaskUpdateSchema } from "./notes.js";
import { DirectoryEntrySchema, SkillsInputSchema, SuggestionSchema, VolunteerSkillSchema, VolunteerSkillsSchema } from "./skills.js";
import { GuardStatusSchema, HeldNumbersSchema } from "./guard.js";
import { ApiKeyAddSchema, ApiKeyListSchema, ApiKeySchema, ApiKeyUpdateSchema, UsageBudgetSchema, UsageSetBudgetSchema, UsageSummarySchema } from "./usage.js";

/**
 * The single source of truth for every back-office ⇄ API call.
 * Server: `implement(contract)` in apps/api. Client: `ContractRouterClient<typeof contract>` in apps/backoffice.
 * All procedures require a volunteer session except `auth.login`, `auth.signup`, `auth.verifyEmail` and `system.health`.
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
  logout: base.output(z.void()),
  me: base.output(VolunteerSchema),
  setUiLanguage: base.input(z.object({ language: LanguageSchema })).output(VolunteerSchema),
  /** Public: the link in the verification e-mail. Always `{ ok: true }` for a well-formed token (no oracle). */
  verifyEmail: base.input(z.object({ token: z.string().min(20).max(100) })).output(z.object({ ok: z.literal(true) })),
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

/** Account management (admin, `volunteers.manage`): approve self-signups, change roles, disable accounts. */
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

const system = {
  health: oc.output(z.object({ ok: z.boolean(), mode: z.enum(["sandbox", "meta"]), llm: z.enum(["anthropic", "fake"]), chat: z.enum(["review", "auto"]).optional(), signup: z.boolean().optional(), emailVerification: z.boolean().optional() })),
};

export const contract = { auth, letters, beneficiaries, documents, sandbox, knowledge, conversations, volunteers, usage, notes, tasks, skills, numbers, system };
export type Contract = typeof contract;
