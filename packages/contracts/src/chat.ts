import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";
import { LetterSourceRefSchema } from "./knowledge.js";
import { LanguageSchema } from "./languages.js";

/**
 * Free-form chatbot on WhatsApp. Grounded in the knowledge base; never legal advice; always points to the association.
 * CHAT_MODE=review (default): every bot answer is a draft a volunteer approves. CHAT_MODE=auto: sent immediately,
 * except legal/urgent/human-requested messages which always go to volunteers.
 */
export const ChatIntentSchema = z.enum([
  "info", // general practical question (where, how, what document…)
  "legal", // asks what to decide / their chances / whether to appeal → volunteer, no answer on substance
  "urgent", // danger, health emergency, no shelter tonight, deadline today → fixed emergency info + volunteer
  "human", // wants to talk to a person
  "letter", // wants a letter explained → redirect to the photo flow
  "document", // about stored documents → redirect to "my documents"
  "smalltalk",
  "out_of_scope",
]);
export type ChatIntent = z.infer<typeof ChatIntentSchema>;

export const ConversationStatusSchema = z.enum([
  "bot", // nothing waiting for a volunteer
  "pending_review", // at least one bot draft waiting
  "needs_human", // handoff requested or legal/urgent detected
  "resolved", // a volunteer closed the handoff
]);

export const ChatMessageSchema = z.object({
  id: IdSchema,
  author: z.enum(["beneficiary", "bot", "volunteer", "system"]),
  /** Text as the beneficiary sees it (their language). */
  text: z.string(),
  /** French version for volunteers (null when the conversation is in French or not available). */
  textFr: z.string().nullable(),
  at: TimestampSchema,
  /** draft = bot answer waiting for review; rejected = never sent. */
  state: z.enum(["received", "draft", "sent", "rejected"]),
  intent: ChatIntentSchema.nullable(),
  sources: z.array(LetterSourceRefSchema),
  volunteerName: z.string().nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationSummarySchema = z.object({
  beneficiaryId: IdSchema,
  beneficiaryLabel: z.string(),
  language: LanguageSchema,
  status: ConversationStatusSchema,
  lastMessageAt: TimestampSchema.nullable(),
  /** Last beneficiary message, French version when available. */
  lastPreview: z.string().nullable(),
  pendingDrafts: z.number().int(),
});

export const ConversationDetailSchema = ConversationSummarySchema.extend({
  messages: z.array(ChatMessageSchema),
});
