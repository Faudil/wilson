import type { ChatIntent, DocumentAnalysis, LanguageCode, LetterAnalysis, LetterText } from "@wilson/contracts";

/** Raw file handed to the model. Decrypted in memory only; never written to disk. */
export interface LlmFile {
  bytes: Buffer;
  /** image/jpeg, image/png, image/webp, application/pdf */
  mimeType: string;
}

/**
 * Generic LLM interface. Every model integration (Anthropic today; Mistral, Bedrock/Vertex EU, self-hosted later)
 * implements this and nothing else. Implementations MUST return objects that pass the contracts' Zod schemas
 * (validate + one repair retry internally) and throw LlmError otherwise.
 * No beneficiary identity or conversation history is ever passed in.
 */
export interface LlmProvider {
  readonly name: string;
  /** Vision: explain an official letter. `fr` prose for the reviewer, `target` prose in `targetLanguage`. */
  analyzeLetter(input: { file: LlmFile; targetLanguage: LanguageCode; today: string }): Promise<LetterAnalysis>;
  /** Vision: classify a personal document and read its expiry date. */
  analyzeDocument(input: { file: LlmFile; today: string }): Promise<DocumentAnalysis>;
  /** Text: which of the supported languages is this message written in? */
  detectLanguage(input: { text: string }): Promise<{ language: LanguageCode | null; confidence: number }>;
  /** Text: translate reviewer-edited French prose into the beneficiary's language (same structure). */
  translateLetterText(input: { fr: LetterText; targetLanguage: LanguageCode }): Promise<LetterText>;
  /**
   * RAG orientation step (after analyzeLetter): rewrite the "who to turn to" lines using ONLY the given snippets
   * (+ the association, always first). Returns orientation in French and in the target language (same order, 1–4
   * lines) and the snippet ids actually used. Never legal advice; never invents an address, phone or office.
   */
  orientLetter(input: {
    analysis: LetterAnalysis;
    targetLanguage: LanguageCode;
    association: { name: string; contact: string };
    snippets: { id: string; title: string; text: string; url: string | null }[];
  }): Promise<{ fr: string[]; target: string[]; usedIds: string[] }>;
  /**
   * Chatbot step 1 — classify the latest beneficiary message (with short history) and produce a French search query
   * for the knowledge base. History holds plain texts only: no name, phone, or document content.
   */
  planChat(input: { history: ChatTurn[]; language: LanguageCode }): Promise<ChatPlan>;
  /**
   * Chatbot step 2 — answer in the beneficiary's language from the snippets only (+ association), with a French
   * version for volunteers. Never legal advice, never invents addresses; if snippets don't cover it, say so and
   * point to the association. ≤ 900 chars.
   */
  chatReply(input: {
    history: ChatTurn[];
    language: LanguageCode;
    intent: ChatIntent;
    association: { name: string; contact: string };
    snippets: { id: string; title: string; text: string; url: string | null }[];
    today: string;
  }): Promise<{ text: string; textFr: string; usedIds: string[] }>;
  /** Generic translation (volunteer replies written in French; beneficiary messages shown in French to volunteers). */
  translateText(input: { text: string; from: LanguageCode | "auto"; to: LanguageCode }): Promise<string>;
}

export interface ChatPlan {
  intent: ChatIntent;
  frenchQuery: string;
  needsHuman: boolean;
  /** The person needs a place to sleep, eat, wash or get clothes today (also set with intent "urgent"). */
  needsPlaces?: boolean;
}

export interface ChatTurn {
  role: "beneficiary" | "assistant";
  text: string;
}

export class LlmError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "LlmError";
  }
}
