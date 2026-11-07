import Anthropic from "@anthropic-ai/sdk";
import {
  ChatIntentSchema,
  DocumentAnalysisSchema,
  LANGUAGE_CODES,
  LanguageSchema,
  LetterAnalysisSchema,
  LetterTextSchema,
  type ChatIntent,
  type DocumentAnalysis,
  type LanguageCode,
  type LetterAnalysis,
  type LetterText,
} from "@wilson/contracts";
import { z } from "zod";
import { LlmError, type ChatPlan, type ChatTurn, type LlmFile, type LlmProvider } from "./provider.js";
import { promptVersion, renderPrompt, type PromptName } from "./prompts.js";
import type { UsageTask } from "@wilson/contracts";
import type { UsageMeter } from "../usage/service.js";

/** The subset of the SDK client we use (lets tests inject a mock). */
export interface AnthropicLike {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  model: string;
  /**
   * Model for the short calls a WhatsApp reply waits on (intent, language detection, chat translation).
   * Defaults to `model`; a faster model here cuts the bot's reply time.
   */
  fastModel?: string;
  client?: AnthropicLike;
  maxTokens?: number;
  /** Records tokens + estimated cost of every call, picks the API key and enforces budgets (see src/usage). */
  meter?: UsageMeter;
  /** Builds the client for an admin-added key (tests inject a mock). */
  clientForKey?: (apiKey: string) => AnthropicLike;
}

/** Errors that mean "this key cannot be used" rather than "this request is wrong": try the next key. */
function isKeyProblem(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return (status === 400 || status === 402) && /credit balance|billing|spend limit/i.test(msg);
}

/** Which task / language a call is for, for usage tracking only. */
interface CallTag {
  task: UsageTask;
  language: LanguageCode | null;
  /** A short call the WhatsApp reply waits on: sent to `fastModel`. */
  fast?: boolean;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const LanguageDetectionSchema = z.object({
  language: z.union([LanguageSchema, z.literal("unknown")]),
  confidence: z.number().min(0).max(1),
});

const LANGUAGE_NAMES_EN: Record<LanguageCode, string> = {
  fr: "French",
  en: "English",
  ar: "Arabic",
  fa: "Dari (Afghan Persian)",
  ps: "Pashto",
  ur: "Urdu",
  uk: "Ukrainian",
  ti: "Tigrinya",
  so: "Somali",
  am: "Amharic",
  ru: "Russian",
  es: "Spanish",
  pt: "Portuguese",
  tr: "Turkish",
  ku: "Kurdish (Kurmanji)",
  ckb: "Central Kurdish (Sorani)",
  bn: "Bengali",
  ta: "Tamil",
  ka: "Georgian",
  hy: "Armenian",
  sq: "Albanian",
  ro: "Romanian",
  ht: "Haitian Creole",
  wo: "Wolof",
  ff: "Fula (Pulaar)",
  bm: "Bambara",
  ln: "Lingala",
  sw: "Swahili",
};
export const languageNameEn = (l: LanguageCode): string => LANGUAGE_NAMES_EN[l];

function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (m?.[1]) return m[1];
  // Tolerate stray prose around a single JSON object.
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 || (last >= 0 && last < t.length - 1)) {
    if (first >= 0 && last > first) return t.slice(first, last + 1);
  }
  return t;
}

const OrientationOutSchema = z.object({
  fr: z.array(z.string().min(1).max(400)).min(1).max(4),
  target: z.array(z.string().min(1).max(400)).min(1).max(4),
  usedIds: z.array(z.string()),
});

const ChatPlanSchema = z.object({
  intent: ChatIntentSchema,
  frenchQuery: z.string().max(300),
  needsHuman: z.boolean(),
  needsPlaces: z.boolean().default(false),
});

const ChatReplyOutSchema = z.object({
  text: z.string().min(1).max(900),
  textFr: z.string().min(1).max(900),
  usedIds: z.array(z.string()),
});

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  /** Server-key client (ANTHROPIC_API_KEY, or the test mock); null when the server has no key of its own. */
  private readonly client: AnthropicLike | null;
  private readonly keyClients = new Map<string, AnthropicLike>();
  private readonly makeClient: (apiKey: string) => AnthropicLike;
  private readonly model: string;
  private readonly fastModel: string;
  private readonly maxTokens: number;
  private readonly meter: UsageMeter | undefined;

  constructor(opts: AnthropicProviderOptions) {
    this.model = opts.model;
    this.fastModel = opts.fastModel ?? opts.model;
    this.meter = opts.meter;
    this.maxTokens = opts.maxTokens ?? 16000;
    this.client = opts.client ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : null);
    this.makeClient = opts.clientForKey ?? ((apiKey) => new Anthropic({ apiKey }));
  }

  private fileBlock(file: LlmFile): Anthropic.ContentBlockParam {
    const data = file.bytes.toString("base64");
    if (file.mimeType === "application/pdf") {
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    }
    if ((IMAGE_TYPES as readonly string[]).includes(file.mimeType)) {
      return { type: "image", source: { type: "base64", media_type: file.mimeType as ImageType, data } };
    }
    throw new LlmError(`Unsupported mime type for the model: ${file.mimeType}`);
  }

  /**
   * The only place that calls the API. The meter picks the key (admin-added keys with budget left first, then the
   * server key), checks the budget, and records tokens + cost after (refusals too: they are billed). If the API
   * refuses an admin-added key (invalid, revoked, out of credit), the call is retried once on the next key.
   */
  private async create(tag: CallTag, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
    const failed = new Set<string>();
    for (;;) {
      const choice = this.meter ? await this.meter.beforeCall(tag.task, failed) : { keyId: null, apiKey: null };
      const client = this.clientFor(choice.apiKey);
      let res: Anthropic.Message;
      try {
        res = await client.messages.create({ model: tag.fast ? this.fastModel : this.model, max_tokens: this.maxTokens, messages });
      } catch (e) {
        if (choice.keyId && this.meter && isKeyProblem(e)) {
          await this.meter.keyFailed(choice.keyId, e instanceof Error ? e.message : String(e));
          failed.add(choice.keyId);
          continue;
        }
        throw e;
      }
      const u = res.usage;
      if (this.meter && u) {
        await this.meter.record({
          keyId: choice.keyId,
          task: tag.task,
          model: res.model ?? (tag.fast ? this.fastModel : this.model),
          language: tag.language,
          tokens: {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          },
        });
      }
      return res;
    }
  }

  private clientFor(apiKey: string | null): AnthropicLike {
    if (apiKey === null) {
      if (!this.client) throw new LlmError("No Claude API key: set ANTHROPIC_API_KEY or add a key in Usage > API keys");
      return this.client;
    }
    let c = this.keyClients.get(apiKey);
    if (!c) {
      c = this.makeClient(apiKey);
      this.keyClients.set(apiKey, c);
    }
    return c;
  }

  /** One call, JSON out, Zod-validated, with exactly one repair retry that feeds the validation error back. */
  private async callJson<S extends z.ZodType>(
    tag: CallTag,
    content: Anthropic.ContentBlockParam[],
    schema: S,
    fixup?: (raw: unknown) => unknown,
  ): Promise<z.infer<S>> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        const res = await this.create(tag, messages);
        if (res.stop_reason === "refusal") throw new LlmError("Model refused the request");
        text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      } catch (e) {
        if (e instanceof LlmError) throw e;
        throw new LlmError(`Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`, e);
      }
      try {
        let raw: unknown = JSON.parse(stripFence(text));
        if (fixup) raw = fixup(raw);
        const parsed = schema.safeParse(raw);
        if (parsed.success) return parsed.data;
        lastError = z.prettifyError(parsed.error);
      } catch (e) {
        lastError = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push(
        { role: "assistant", content: text.length > 0 ? text : "(empty)" },
        {
          role: "user",
          content: `Your previous reply was rejected by the validator:\n${lastError}\n\nReply again with ONE corrected JSON object only, matching the required shape exactly. No markdown, no commentary.`,
        },
      );
    }
    throw new LlmError(`Model output failed validation after one repair retry: ${lastError}`);
  }

  private withVersion(name: PromptName) {
    return (raw: unknown) =>
      raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as object), promptVersion: promptVersion(name) } : raw;
  }

  async analyzeLetter(input: { file: LlmFile; targetLanguage: LanguageCode; today: string }): Promise<LetterAnalysis> {
    const prompt = renderPrompt("letter-analysis", {
      today: input.today,
      targetLanguageName: languageNameEn(input.targetLanguage),
      targetLanguageCode: input.targetLanguage,
    });
    return this.callJson(
      { task: "letter-analysis", language: input.targetLanguage },
      [this.fileBlock(input.file), { type: "text", text: prompt }],
      LetterAnalysisSchema,
      this.withVersion("letter-analysis"),
    );
  }

  async analyzeDocument(input: { file: LlmFile; today: string }): Promise<DocumentAnalysis> {
    const prompt = renderPrompt("document-analysis", { today: input.today });
    return this.callJson(
      { task: "document-analysis", language: null },
      [this.fileBlock(input.file), { type: "text", text: prompt }],
      DocumentAnalysisSchema,
      this.withVersion("document-analysis"),
    );
  }

  async detectLanguage(input: { text: string }): Promise<{ language: LanguageCode | null; confidence: number }> {
    const prompt = renderPrompt("language-detect", {
      languageList: LANGUAGE_CODES.map((c) => `"${c}"`).join(", "),
      text: input.text.slice(0, 1000),
    });
    const r = await this.callJson({ task: "language-detect", language: null, fast: true }, [{ type: "text", text: prompt }], LanguageDetectionSchema);
    return { language: r.language === "unknown" ? null : r.language, confidence: r.confidence };
  }

  async translateLetterText(input: { fr: LetterText; targetLanguage: LanguageCode }): Promise<LetterText> {
    const prompt = renderPrompt("letter-translate", {
      targetLanguageName: languageNameEn(input.targetLanguage),
      targetLanguageCode: input.targetLanguage,
      frJson: JSON.stringify(input.fr, null, 2),
    });
    const out = await this.callJson({ task: "letter-translate", language: input.targetLanguage }, [{ type: "text", text: prompt }], LetterTextSchema);
    if (out.actions.length !== input.fr.actions.length || out.orientation.length !== input.fr.orientation.length) {
      throw new LlmError("Translation changed the number of actions or orientation entries");
    }
    return out;
  }

  async orientLetter(input: {
    analysis: LetterAnalysis;
    targetLanguage: LanguageCode;
    association: { name: string; contact: string };
    snippets: { id: string; title: string; text: string; url: string | null }[];
  }): Promise<{ fr: string[]; target: string[]; usedIds: string[] }> {
    const { analysis: a } = input;
    const inputJson = JSON.stringify(
      {
        analysis: {
          letterType: a.letterType,
          issuer: a.issuer,
          title: a.fr.title,
          summary: a.fr.summary,
          actions: a.fr.actions,
          currentOrientation: a.fr.orientation,
        },
        association: input.association,
        snippets: input.snippets.map((s) => ({ id: s.id, title: s.title, url: s.url, text: s.text })),
      },
      null,
      2,
    );
    const prompt = renderPrompt("letter-orientation", {
      targetLanguageName: languageNameEn(input.targetLanguage),
      targetLanguageCode: input.targetLanguage,
      inputJson,
    });
    const out = await this.callJson({ task: "letter-orientation", language: input.targetLanguage }, [{ type: "text", text: prompt }], OrientationOutSchema);
    if (out.fr.length !== out.target.length) throw new LlmError("Orientation: fr and target have different lengths");
    const known = new Set(input.snippets.map((s) => s.id));
    return { fr: out.fr, target: out.target, usedIds: [...new Set(out.usedIds.filter((id) => known.has(id)))] };
  }
  /** One plain-text call (no JSON), no retry beyond the SDK's own. */
  private async callText(tag: CallTag, prompt: string): Promise<string> {
    let text: string;
    try {
      const res = await this.create(tag, [{ role: "user", content: prompt }]);
      if (res.stop_reason === "refusal") throw new LlmError("Model refused the request");
      text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(`Anthropic request failed: ${e instanceof Error ? e.message : String(e)}`, e);
    }
    if (!text) throw new LlmError("Empty model reply");
    return text;
  }

  async planChat(input: { history: ChatTurn[]; language: LanguageCode }): Promise<ChatPlan> {
    const prompt = renderPrompt("chat-plan", {
      targetLanguageName: languageNameEn(input.language),
      targetLanguageCode: input.language,
      historyJson: JSON.stringify(input.history, null, 2),
    });
    const out = await this.callJson({ task: "chat-plan", language: input.language, fast: true }, [{ type: "text", text: prompt }], ChatPlanSchema);
    const needsHuman = out.needsHuman || out.intent === "legal" || out.intent === "urgent" || out.intent === "human";
    return { intent: out.intent, frenchQuery: out.frenchQuery.trim(), needsHuman, needsPlaces: out.needsPlaces || out.intent === "places" };
  }

  async chatReply(input: {
    history: ChatTurn[];
    language: LanguageCode;
    intent: ChatIntent;
    association: { name: string; contact: string };
    snippets: { id: string; title: string; text: string; url: string | null }[];
    today: string;
  }): Promise<{ text: string; textFr: string; usedIds: string[] }> {
    const inputJson = JSON.stringify(
      {
        history: input.history,
        intent: input.intent,
        association: input.association,
        snippets: input.snippets.map((s) => ({ id: s.id, title: s.title, url: s.url, text: s.text })),
        today: input.today,
      },
      null,
      2,
    );
    const prompt = renderPrompt("chat-reply", {
      targetLanguageName: languageNameEn(input.language),
      targetLanguageCode: input.language,
      today: input.today,
      inputJson,
    });
    const out = await this.callJson({ task: "chat-reply", language: input.language }, [{ type: "text", text: prompt }], ChatReplyOutSchema);
    const known = new Set(input.snippets.map((s) => s.id));
    return { text: out.text, textFr: out.textFr, usedIds: [...new Set(out.usedIds.filter((id) => known.has(id)))] };
  }

  async translateText(input: { text: string; from: LanguageCode | "auto"; to: LanguageCode }): Promise<string> {
    if (input.from === input.to) return input.text;
    const prompt = renderPrompt("chat-translate", {
      fromName: input.from === "auto" ? "its original language (detect it)" : languageNameEn(input.from),
      targetLanguageName: languageNameEn(input.to),
      targetLanguageCode: input.to,
      text: input.text.slice(0, 4000),
    });
    const language = input.to !== "fr" ? input.to : input.from === "auto" ? null : input.from;
    return this.callText({ task: "chat-translate", language, fast: true }, prompt);
  }
}
