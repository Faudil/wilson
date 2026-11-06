import { oc } from "@orpc/contract";
import { z } from "zod";
import { LoginInputSchema, VolunteerSchema } from "./auth.js";
import { BeneficiaryDetailSchema, BeneficiarySummarySchema } from "./beneficiaries.js";
import { CalendarDateSchema, IdSchema, pageOf, PageInputSchema } from "./common.js";
import { DeadlineRowSchema, DocumentSchema, DocumentUpdateSchema } from "./documents.js";
import { KnowledgeHitSchema, KnowledgeSearchInputSchema, KnowledgeSourceIdSchema, KnowledgeSourceSchema } from "./knowledge.js";
import { LanguageSchema } from "./languages.js";
import { LetterDetailSchema, LetterEditSchema, LetterStatusSchema, LetterSummarySchema } from "./letters.js";
import { SandboxMessageSchema, SandboxPhoneSchema, SandboxSendInputSchema } from "./sandbox.js";

/**
 * The single source of truth for every back-office ⇄ API call.
 * Server: `implement(contract)` in apps/api. Client: `ContractRouterClient<typeof contract>` in apps/backoffice.
 * All procedures require a volunteer session except `auth.login` and `system.health`.
 */

const base = oc.errors({
  UNAUTHORIZED: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  CONFLICT: { data: z.object({ reason: z.string() }) },
});

const auth = {
  login: base.input(LoginInputSchema).output(VolunteerSchema),
  logout: base.output(z.void()),
  me: base.output(VolunteerSchema),
  setUiLanguage: base.input(z.object({ language: LanguageSchema })).output(VolunteerSchema),
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

/** Knowledge base (RAG) used to ground orientation. */
const knowledge = {
  sources: base.output(z.array(KnowledgeSourceSchema)),
  /** Same retrieval the orientation step uses — lets volunteers check what the AI will see. */
  search: base.input(KnowledgeSearchInputSchema).output(z.array(KnowledgeHitSchema)),
  /** Re-download and re-index one source (admin). Runs in the background. */
  sync: base.input(z.object({ sourceId: KnowledgeSourceIdSchema })).output(z.object({ queued: z.boolean() })),
};

const system = {
  health: oc.output(z.object({ ok: z.boolean(), mode: z.enum(["sandbox", "meta"]), llm: z.enum(["anthropic", "fake"]) })),
};

export const contract = { auth, letters, beneficiaries, documents, sandbox, knowledge, system };
export type Contract = typeof contract;
