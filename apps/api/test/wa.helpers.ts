import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { asc, eq } from "drizzle-orm";
import { LetterAnalysisSchema, type LanguageCode, type LetterAnalysis, type LetterText, type WaInboundMessage } from "@wilson/contracts";
import { processInbound } from "../src/conversation/engine.js";
import { beneficiaries, messages } from "../src/db/schema.js";
import { createLettersService } from "../src/letters/service.js";
import { LlmError, type LlmProvider } from "../src/llm/provider.js";
import { adoptServices } from "../src/services.js";
import type { WaDeps } from "../src/whatsapp/context.js";
import { SandboxTransport, putSandboxMedia } from "../src/whatsapp/sandbox.js";
import type { Interactive } from "../src/whatsapp/interactive.js";
import type { WhatsAppTransport } from "../src/whatsapp/transport.js";
import { MetaApiError } from "../src/whatsapp/meta.js";
import { registerWhatsAppWorkers } from "../src/whatsapp/workers.js";
import { createVolunteer, makeTestDeps, PNG_BYTES, type TestCtx } from "./helpers.js";

export const FR: LetterText = {
  title: "La préfecture vous convoque.",
  summary: "Rendez-vous à la préfecture.",
  actions: ["Apportez vos originaux."],
  orientation: ["L'association peut vous aider."],
};

export class TestLlm implements LlmProvider {
  readonly name = "test";
  translateCalls = 0;
  analyzeCalls = 0;
  failAnalyze = false;
  nextLanguage: { language: LanguageCode | null; confidence: number } = { language: null, confidence: 0 };
  async analyzeLetter(input: { targetLanguage: LanguageCode }): Promise<LetterAnalysis> {
    this.analyzeCalls++;
    if (this.failAnalyze) throw new LlmError("bad json");
    return LetterAnalysisSchema.parse({
      promptVersion: "test@1", isOfficialLetter: true, letterType: "prefecture_residence_permit", issuer: "Préfecture", references: [],
      letterDate: "2026-11-03",
      deadline: { date: "2026-12-08", kind: "appointment", explicit: true, sourceQuote: "le 8 décembre 2026" },
      urgency: "medium", confidence: 0.9, reviewerWarnings: [],
      fr: FR,
      target: { title: `[${input.targetLanguage}] TITLE`, summary: "SUMMARY", actions: ["ACTION"], orientation: ["ORIENT"] },
    });
  }
  async analyzeDocument(): Promise<never> {
    throw new Error("n/a");
  }
  async detectLanguage() {
    return this.nextLanguage;
  }
  async translateLetterText(input: { fr: LetterText }): Promise<LetterText> {
    this.translateCalls++;
    return { ...input.fr, title: `RETRANSLATED ${input.fr.title}` };
  }
  async planChat() {
    return { intent: "info" as const, frenchQuery: "", needsHuman: false };
  }
  async chatReply() {
    return { text: "stub", textFr: "stub", usedIds: [] as string[] };
  }
  async translateText(input: { text: string }) {
    return input.text;
  }
  async orientLetter(input: { analysis: LetterAnalysis }) {
    return { fr: input.analysis.fr.orientation, target: input.analysis.target.orientation, usedIds: [] as string[] };
  }
}

/** Meta-mode transport double. */
export class FakeMeta implements WhatsAppTransport {
  readonly mode = "meta" as const;
  texts: { to: string; body: string }[] = [];
  templates: { to: string; template: string; params: string[] }[] = [];
  /** Meta error code the next sendText fails with (e.g. 131047, window closed on Meta's side). */
  failNextText: number | null = null;
  read: string[] = [];
  async sendText(to: string, body: string) {
    if (this.failNextText) {
      const code = this.failNextText;
      this.failNextText = null;
      throw new MetaApiError(`send message failed: code ${code}`, 400, code);
    }
    this.texts.push({ to, body });
    return { waMessageId: `wamid.out.${randomUUID()}` };
  }
  interactives: { to: string; message: Interactive }[] = [];
  async sendInteractive(to: string, message: Interactive) {
    this.interactives.push({ to, message });
    return { waMessageId: `wamid.int.${randomUUID()}` };
  }
  async sendTemplate(to: string, template: string, _l: LanguageCode, params: string[]) {
    this.templates.push({ to, template, params });
    return { waMessageId: `wamid.tpl.${randomUUID()}` };
  }
  async downloadMedia() {
    return { bytes: PNG_BYTES, mimeType: "image/png" };
  }
  async markRead(id: string) {
    this.read.push(id);
  }
}

export interface WaCtx extends TestCtx {
  wdeps: WaDeps;
  tllm: TestLlm;
  meta: FakeMeta | null;
  volunteerId: string;
  /** Inbound text, then run the queue dry. */
  say(phone: string, text: string): Promise<void>;
  photo(phone: string, mime?: string): Promise<void>;
  /** Decrypted outbound bodies (sandbox/meta alike), oldest first. */
  outbound(phone: string): Promise<string[]>;
  drain(): Promise<void>;
}

let seq = 0;
const base = (from: string) => ({ id: `wamid.${++seq}.${randomUUID()}`, from, timestamp: "1" });

export async function makeWa(opts: { meta?: boolean; now?: string; config?: Record<string, string> } = {}): Promise<WaCtx> {
  const config: Record<string, string> = {
    ...(opts.meta
      ? { WHATSAPP_MODE: "meta", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_VERIFY_TOKEN: "verify-me" }
      : {}),
    ...opts.config,
  };
  const ctx = await makeTestDeps({ now: opts.now, config });
  const tllm = new TestLlm();
  const meta = opts.meta ? new FakeMeta() : null;
  const beneficiariesSvc = ctx.services.beneficiaries;
  const wa = meta ?? new SandboxTransport({ db: ctx.deps.db, crypto: ctx.deps.crypto, blobs: ctx.deps.blobs, beneficiaries: beneficiariesSvc });
  const d0 = { ...ctx.deps, llm: tllm, wa };
  const letters = createLettersService(d0, beneficiariesSvc);
  const wdeps: WaDeps = { ...d0, beneficiaries: beneficiariesSvc, documents: ctx.services.documents, letters };
  adoptServices(ctx.deps, wdeps);
  await registerWhatsAppWorkers(wdeps, ctx.queue);
  const volunteer = await createVolunteer(ctx.deps);
  const drain = async () => void (await ctx.queue.drain());

  const run = async (msg: WaInboundMessage) => {
    await processInbound(wdeps, msg);
    await drain();
  };
  return {
    ...ctx, wdeps, tllm, meta, volunteerId: volunteer.id, drain,
    say: (phone, text) => run({ ...base(phone), type: "text", text: { body: text } }),
    async photo(phone, mime = "image/png") {
      let id = "meta-media-1";
      if (!meta) {
        const { beneficiary } = await beneficiariesSvc.findOrCreateByWaId(phone);
        id = await putSandboxMedia(wdeps, beneficiary.id, PNG_BYTES, mime);
      }
      await run({ ...base(phone), type: "image", image: { id, mime_type: mime } });
    },
    async outbound(phone) {
      const [b] = await ctx.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, ctx.deps.crypto.lookupHash(phone)));
      if (!b) return [];
      const dek = await beneficiariesSvc.getDek(b.id);
      const rows = await ctx.deps.db.select().from(messages).where(eq(messages.beneficiaryId, b.id)).orderBy(asc(messages.createdAt));
      return rows.filter((m) => m.direction === "out" && m.bodyEnc).map((m) => ctx.deps.crypto.decrypt(dek, m.bodyEnc!).toString("utf8"));
    },
  };
}

/** Minimal req/res doubles for the raw HTTP handler. */
export function fakeHttp(method: string, url: string, headers: Record<string, string> = {}, body = ""): { req: IncomingMessage; res: ServerResponse; result: { status: number; body: string } } {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method, url, headers }) as unknown as IncomingMessage;
  const result = { status: 0, body: "" };
  const res = {
    writeHead(s: number) { result.status = s; return this; },
    end(b?: string) { result.body = b ?? ""; },
  } as unknown as ServerResponse;
  return { req, res, result };
}
