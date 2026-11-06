import { and, eq } from "drizzle-orm";
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode, type WaInboundMessage } from "@wilson/contracts";
import { documentTypeName, formatDate, parseUserDate, waText } from "@wilson/i18n";
import type { BeneficiaryRow } from "../beneficiaries/service.js";
import { letters, messages, type ConversationState } from "../db/schema.js";
import { JOBS } from "../jobs/names.js";
import { todayIn, type WaDeps } from "../whatsapp/context.js";
import { enqueueText, footerFor } from "../whatsapp/send.js";
import { announceDocumentDetection } from "./documentFlow.js";
import { getChat } from "../chat/service.js";
import { isLanguageWord, isMenuWord, menuChoice } from "./text.js";

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const SUPPORTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);

type Input =
  | { type: "text"; text: string }
  | { type: "file"; mediaId: string; mime: string }
  | { type: "voice" } // audio / voice note
  | { type: "media_unsupported" } // video, sticker
  | { type: "other" } // location, contacts, unsupported
  | { type: "ignore" }; // reactions

interface Ctx {
  deps: WaDeps;
  b: BeneficiaryRow;
  lang: LanguageCode;
  state: ConversationState;
  /** Meta message id of the inbound message being processed (its row already exists). */
  msgId: string;
}

function classify(msg: WaInboundMessage): Input {
  switch (msg.type) {
    case "text": return { type: "text", text: msg.text.body };
    case "image": return { type: "file", mediaId: msg.image.id, mime: msg.image.mime_type };
    case "document": return { type: "file", mediaId: msg.document.id, mime: msg.document.mime_type };
    case "interactive": {
      const r = msg.interactive.button_reply ?? msg.interactive.list_reply;
      return r ? { type: "text", text: r.title } : { type: "other" };
    }
    case "audio": return { type: "voice" };
    case "video": case "sticker": return { type: "media_unsupported" };
    case "reaction": return { type: "ignore" };
    default: return { type: "other" };
  }
}

function inboundText(msg: WaInboundMessage): string | null {
  switch (msg.type) {
    case "text": return msg.text.body;
    case "image": return msg.image.caption ?? null;
    case "document": return msg.document.caption ?? null;
    case "interactive": return (msg.interactive.button_reply ?? msg.interactive.list_reply)?.title ?? null;
    default: return null;
  }
}

/**
 * Entry point for every inbound WhatsApp message (webhook and sandbox). Idempotent on the Meta message id.
 * All replies go through the wa.send queue.
 */
export async function processInbound(deps: WaDeps, msg: WaInboundMessage): Promise<void> {
  const { beneficiaries, db, crypto } = deps;
  const { beneficiary } = await beneficiaries.findOrCreateByWaId(msg.from);
  if (beneficiary.archivedAt) return; // asked for deletion: stay silent

  const dek = await beneficiaries.getDek(beneficiary.id);
  const body = inboundText(msg);
  const mediaId = msg.type === "image" ? msg.image.id : msg.type === "document" ? msg.document.id : null;
  const inserted = await db.insert(messages).values({
    beneficiaryId: beneficiary.id,
    direction: "in",
    kind: msg.type === "text" || msg.type === "image" || msg.type === "document" || msg.type === "interactive" ? msg.type : "other",
    waMessageId: msg.id,
    bodyEnc: body ? crypto.encrypt(dek, body) : null,
    mediaKey: mediaId?.startsWith("sandbox/") ? mediaId : null,
    status: "received",
  }).onConflictDoNothing().returning({ id: messages.id });
  if (!inserted.length) return; // duplicate delivery
  await beneficiaries.touchInbound(beneficiary.id, deps.now());

  const input = classify(msg);
  const ctx: Ctx = { deps, b: beneficiary, lang: beneficiary.language, state: beneficiary.conversationState, msgId: msg.id };

  // A reviewed explanation (or rejection notice) is waiting behind the opt-in template: any message releases it.
  await getChat(deps).flushQueued(beneficiary.id); // chatbot answers held behind the 24 h window
  const released = await releaseAwaiting(ctx);
  if (released && input.type !== "file") return;
  if (input.type === "ignore") return;

  await dispatch(ctx, input);
}

async function releaseAwaiting(ctx: Ctx): Promise<boolean> {
  const { deps, b } = ctx;
  const waiting = await deps.db.select({ id: letters.id, status: letters.status }).from(letters)
    .where(and(eq(letters.beneficiaryId, b.id), eq(letters.awaitingOptIn, true)));
  for (const l of waiting) {
    if (l.status === "approved") {
      await deps.jobs.send(JOBS.waSend, { kind: "letter_reply", letterId: l.id });
    } else {
      await deps.db.update(letters).set({ awaitingOptIn: false }).where(eq(letters.id, l.id));
      if (l.status === "rejected") {
        await enqueueText(deps, b.id, `${waText(ctx.lang, "letter_rejected")}\n\n${footerFor(deps, ctx.lang)}`, { letterId: l.id });
      }
    }
  }
  return waiting.length > 0;
}

// ---------------------------------------------------------------- helpers

const say = (c: Ctx, text: string) => enqueueText(c.deps, c.b.id, text);
const sayKey = (c: Ctx, key: Parameters<typeof waText>[1], params?: Parameters<typeof waText>[2]) => say(c, waText(c.lang, key, params));
const setState = async (c: Ctx, s: ConversationState) => {
  c.state = s;
  await c.deps.beneficiaries.setConversationState(c.b.id, s);
};
const showLanguageMenu = async (c: Ctx) => {
  await setState(c, { step: "choose_language" });
  await say(c, waText("fr", "language_menu"));
};
const showMainMenu = async (c: Ctx, intro?: Parameters<typeof waText>[1]) => {
  await setState(c, { step: "main_menu" });
  if (intro) await sayKey(c, intro);
  await sayKey(c, "main_menu");
};
const today = (c: Ctx) => todayIn(c.deps.now(), c.deps.config.TIMEZONE);

// ---------------------------------------------------------------- dispatcher

async function dispatch(c: Ctx, input: Input): Promise<void> {
  switch (c.state.step) {
    case "choose_language": return onChooseLanguage(c, input);
    case "main_menu":
    case "chat":
    case "await_letter_photo":
    case "await_document_file":
    case "offer_save_letter":
      return onFreeState(c, input);
    case "confirm_document": return onConfirmDocument(c, input, c.state.documentId);
    case "enter_document_date": return onEnterDate(c, input, c.state.documentId);
    case "confirm_delete_all": return onConfirmDelete(c, input);
  }
}

async function setLanguageAndGo(c: Ctx, code: LanguageCode): Promise<void> {
  const first = !c.b.languageConfirmed;
  await c.deps.beneficiaries.setLanguage(c.b.id, code, true);
  c.lang = code;
  c.b = { ...c.b, language: code, languageConfirmed: true };
  if (first) await sayKey(c, "welcome");
  else await sayKey(c, "language_set", { language: LANGUAGES[code].nativeName });
  await showMainMenu(c);
}

async function onChooseLanguage(c: Ctx, input: Input): Promise<void> {
  if (input.type === "text") {
    const n = menuChoice(input.text);
    if (n !== null) {
      const code = LANGUAGE_CODES[Number(n) - 1];
      if (code) return setLanguageAndGo(c, code);
    } else if (input.text.trim().length >= 2) {
      try {
        const det = await c.deps.llm.detectLanguage({ text: input.text });
        if (det.language && det.confidence >= 0.8) return setLanguageAndGo(c, det.language);
      } catch {
        /* detection is best effort: fall back to the menu */
      }
    }
  }
  await showLanguageMenu(c);
}

/** main_menu, await_letter_photo, await_document_file, offer_save_letter */
async function onFreeState(c: Ctx, input: Input): Promise<void> {
  if (input.type === "file") {
    if (c.state.step === "await_document_file") return onDocumentFile(c, input);
    return onLetterFile(c, input);
  }
  if (input.type === "voice") return sayKey(c, "chat_voice_unsupported");
  if (input.type === "media_unsupported") return sayKey(c, "letter_unsupported_media");
  if (input.type === "other") return sayKey(c, "not_understood");

  if (input.type !== "text") return;
  const choice = isLanguageWord(input.text) ? "3" : menuChoice(input.text);

  if (c.state.step === "offer_save_letter") {
    if (choice === "1" || choice === "2") return onOfferAnswer(c, choice === "1", c.state.letterId);
    return sayKey(c, "letter_offer_save");
  }
  if (isMenuWord(input.text)) return showMainMenu(c);
  // Free text (anything that is not a menu number) goes to the chatbot — also while we wait for a photo/file
  // (the state is kept, so the photo can still be sent afterwards).
  if (choice === null) {
    return getChat(c.deps).handleMessage(c.b.id, input.text, { waMessageId: c.msgId });
  }
  switch (choice) {
    case "4":
      await setState(c, { step: "chat" });
      return sayKey(c, "chat_intro");
    case "1":
      await setState(c, { step: "await_letter_photo" });
      return sayKey(c, "letter_ask_photo");
    case "2": {
      const docs = await c.deps.documents.listForBeneficiary(c.b.id);
      if (docs.length) {
        const list = docs
          .map((d) => `• ${documentTypeName(d.type, c.lang)}${d.expiresAt ? ` — ${formatDate(d.expiresAt, c.lang)}` : ""}`)
          .join("\n");
        await sayKey(c, "document_list", { list });
      } else {
        await sayKey(c, "document_list_empty");
      }
      await setState(c, { step: "await_document_file" });
      return sayKey(c, "document_ask_file");
    }
    case "3": return showLanguageMenu(c);
    case "0":
      await setState(c, { step: "main_menu" });
      return sayKey(c, "human_contact", { name: c.deps.config.ASSOCIATION_NAME, contact: c.deps.config.ASSOCIATION_CONTACT });
    case "9":
      await setState(c, { step: "confirm_delete_all" });
      return sayKey(c, "delete_confirm");
    default:
      return showMainMenu(c, "not_understood");
  }
}

// ---------------------------------------------------------------- media

async function fetchMedia(c: Ctx, f: Extract<Input, { type: "file" }>): Promise<{ bytes: Buffer; mimeType: string } | null> {
  try {
    const m = await c.deps.wa.downloadMedia(f.mediaId);
    const mimeType = SUPPORTED_MIME.has(f.mime) ? f.mime : m.mimeType;
    if (!SUPPORTED_MIME.has(mimeType) || m.bytes.length === 0 || m.bytes.length > MAX_MEDIA_BYTES) return null;
    return { bytes: m.bytes, mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType };
  } catch (e) {
    console.error("[conversation] media download failed", (e as Error).message);
    return null;
  }
}

async function onLetterFile(c: Ctx, f: Extract<Input, { type: "file" }>): Promise<void> {
  const media = await fetchMedia(c, f);
  if (!media) return sayKey(c, "letter_unsupported_media");
  await setState(c, { step: "main_menu" });
  await c.deps.letters.receivePhoto({ beneficiaryId: c.b.id, ...media }); // sends the "received" ack and queues the analysis
}

async function onDocumentFile(c: Ctx, f: Extract<Input, { type: "file" }>): Promise<void> {
  const media = await fetchMedia(c, f);
  if (!media) return sayKey(c, "letter_unsupported_media");
  await c.deps.documents.createFromUpload({ beneficiaryId: c.b.id, ...media });
  await sayKey(c, "document_analyzing"); // the document.analyze worker follows up via announceDocumentDetection()
}

// ---------------------------------------------------------------- letter follow-up

async function onOfferAnswer(c: Ctx, save: boolean, letterId: string): Promise<void> {
  const { letters: svc, documents } = c.deps;
  let saved = false;
  if (save) {
    try {
      await documents.createFromLetter({ letterId });
      saved = true;
    } catch (e) {
      console.error("[conversation] could not save letter as document", (e as Error).message); // e.g. photo already purged
    }
  }
  await svc.discardPhoto(letterId); // the document holds its own copy; either way the tmp photo goes now
  await showMainMenu(c, saved ? "letter_saved" : "letter_not_saved");
}

// ---------------------------------------------------------------- documents

async function onConfirmDocument(c: Ctx, input: Input, documentId: string): Promise<void> {
  // The analyze worker puts us here even when no date was detected ("type the date or 0"): then it is a date entry.
  const doc = await c.deps.documents.get(documentId);
  if (doc && !doc.expiresAt) return onEnterDate(c, input, documentId);
  const choice = input.type === "text" ? menuChoice(input.text) : null;
  if (choice === "1") return finishDocument(c, documentId);
  if (choice === "2") {
    await setState(c, { step: "enter_document_date", documentId });
    return sayKey(c, "document_enter_date");
  }
  return announceDocumentDetection(c.deps, documentId); // re-ask
}

async function onEnterDate(c: Ctx, input: Input, documentId: string): Promise<void> {
  if (input.type !== "text") return sayKey(c, "document_enter_date");
  if (menuChoice(input.text) === "0") {
    await c.deps.documents.setExpiry(documentId, null, "entered_by_user");
    return finishDocument(c, documentId);
  }
  const iso = parseUserDate(input.text);
  if (!iso) return sayKey(c, "document_date_invalid");
  await c.deps.documents.setExpiry(documentId, iso, "entered_by_user");
  return announceDocumentDetection(c.deps, documentId); // re-confirm with the date written out
}

async function finishDocument(c: Ctx, documentId: string): Promise<void> {
  const { documents } = c.deps;
  await documents.confirm(documentId);
  const doc = await documents.get(documentId);
  await setState(c, { step: "main_menu" });
  if (!doc) return sayKey(c, "main_menu");
  const type = documentTypeName(doc.type, c.lang);
  const date = doc.expiresAt ? formatDate(doc.expiresAt, c.lang) : "—";
  await sayKey(c, "document_saved", { type, date });
  if (doc.expiresAt && doc.expiresAt < today(c)) await say(c, `${waText(c.lang, "document_expired", { type, date })}\n\n${footerFor(c.deps, c.lang)}`);
  await sayKey(c, "main_menu");
}

// ---------------------------------------------------------------- delete all

async function onConfirmDelete(c: Ctx, input: Input): Promise<void> {
  const choice = input.type === "text" ? menuChoice(input.text) : null;
  if (choice === "1") {
    await setState(c, { step: "main_menu" });
    await say(c, `${waText(c.lang, "delete_done")}\n\n${footerFor(c.deps, c.lang)}`);
    return c.deps.beneficiaries.archiveAll(c.b.id);
  }
  if (choice === "2") return showMainMenu(c);
  return sayKey(c, "delete_confirm");
}
