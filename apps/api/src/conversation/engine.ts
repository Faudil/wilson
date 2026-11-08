import { and, eq, isNotNull } from "drizzle-orm";
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode, type WaInboundMessage } from "@wilson/contracts";
import { LANGUAGE_MENU_HEADER, documentTypeName, formatDate, parseUserDate, waText } from "@wilson/i18n";
import type { BeneficiaryRow } from "../beneficiaries/service.js";
import { letters, messages, type ConversationState } from "../db/schema.js";
import { JOBS } from "../jobs/names.js";
import { localDate } from "../time.js";
import type { WaDeps } from "../whatsapp/context.js";
import { enqueueText, footerFor, letterOfferText, sendTextNow } from "../whatsapp/send.js";
import { announceDocumentDetection } from "./documentFlow.js";
import { getChat } from "../chat/service.js";
import { isLanguageWord, isMenuWord, isStopWord, menuChoice } from "./text.js";
import { getBroadcasts } from "../broadcasts/service.js";
import { getPlaces } from "../places/service.js";
import { looksLikeAddress, nearbyMessage } from "../nearby/service.js";
import type { LatLon } from "../geo/provider.js";
import { isAnnouncementStopButton } from "../whatsapp/templates.js";
import { withUsageContext } from "../usage/context.js";
import { getBuddies } from "../buddies/service.js";
import { buddyEntry, isBuddyStep, onBuddyState, type BuddyFlowCtx } from "./buddyFlow.js";
import { getAppointments } from "../appointments/service.js";
import { isHelpState, onHelpState, startHelp, type FlowIo } from "../appointments/flow.js";
import { getEvents } from "../events/service.js";
import { isEventState, onEventState } from "../events/flow.js";
import { getGuard, quarantine, throttleNotice } from "../whatsapp/guard.js";

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const SUPPORTED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"]);

type Input =
  | { type: "text"; text: string }
  | { type: "file"; mediaId: string; mime: string }
  | { type: "voice" } // audio / voice note
  | { type: "media_unsupported" } // video, sticker
  | { type: "location"; lat: number; lon: number } // 📎 → Location: nearest places, the point is not kept
  | { type: "other" } // contacts, unsupported
  | { type: "ignore" } // reactions
  | { type: "button"; text: string }; // quick-reply tap on a template (opt-in to receive a waiting message)

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
      // Button and list ids are the menu numbers (see whatsapp/interactive.ts): same as typing them.
      const r = msg.interactive.button_reply ?? msg.interactive.list_reply;
      return r ? { type: "text", text: r.id || r.title } : { type: "other" };
    }
    case "audio": return { type: "voice" };
    case "video": case "sticker": return { type: "media_unsupported" };
    case "reaction": return { type: "ignore" };
    case "button": return { type: "button", text: msg.button.text };
    case "location": return { type: "location", lat: msg.location.latitude, lon: msg.location.longitude };
    default: return { type: "other" };
  }
}

function inboundText(msg: WaInboundMessage): string | null {
  switch (msg.type) {
    case "text": return msg.text.body;
    case "image": return msg.image.caption ?? null;
    case "document": return msg.document.caption ?? null;
    case "interactive": return (msg.interactive.button_reply ?? msg.interactive.list_reply)?.title ?? null;
    case "button": return msg.button.text;
    case "location": return "📍"; // that a location was shared, never where
    default: return null;
  }
}

/**
 * Entry point for every inbound WhatsApp message (webhook and sandbox). Idempotent on the Meta message id.
 * All replies go through the wa.send queue.
 */
export async function processInbound(deps: WaDeps, msg: WaInboundMessage): Promise<void> {
  const { beneficiaries, db, crypto } = deps;
  if (msg.type === "system") {
    // WhatsApp's own notice that the person changed number or BSUID: follow them, say nothing.
    const s = msg.system;
    const moved = await beneficiaries.changeIdentity(
      { waId: msg.from, userId: s.previous_user_id ?? msg.from_user_id },
      { waId: s.wa_id ?? s.new_wa_id, userId: s.user_id },
    );
    if (!moved) console.warn(`[whatsapp] identity change (${s.type ?? "unknown"}) matched nobody, or the new number is already known`);
    return;
  }
  const { beneficiary } = await beneficiaries.findOrCreateByWaId(msg.from, msg.from_user_id);
  if (beneficiary.archivedAt) return; // asked for deletion: stay silent
  // Blocked, or held by the flood guard until a volunteer looks: drop before storing or processing anything.
  if (beneficiary.guardStatus !== "none") return;

  const dek = await beneficiaries.getDek(beneficiary.id);
  const body = inboundText(msg);
  const mediaId = msg.type === "image" ? msg.image.id : msg.type === "document" ? msg.document.id : null;
  const inserted = await db.insert(messages).values({
    beneficiaryId: beneficiary.id,
    direction: "in",
    kind: msg.type === "text" || msg.type === "image" || msg.type === "document" || msg.type === "interactive" ? msg.type : msg.type === "button" ? "interactive" : "other",
    waMessageId: msg.id,
    bodyEnc: body ? crypto.encrypt(dek, body) : null,
    mediaKey: mediaId?.startsWith("sandbox/") ? mediaId : null,
    status: "received",
  }).onConflictDoNothing().returning({ id: messages.id });
  if (!inserted.length) return; // duplicate delivery
  await beneficiaries.touchInbound(beneficiary.id, deps.now());

  const input = classify(msg);
  if (input.type !== "ignore") {
    const verdict = getGuard(deps).check(beneficiary, input.type === "file", deps.now());
    if (verdict.kind === "quarantine") return quarantine(deps, beneficiary, verdict.reason);
    if (verdict.kind === "throttle") {
      if (verdict.notify) await throttleNotice(deps, beneficiary);
      return;
    }
  }
  const ctx: Ctx = { deps, b: beneficiary, lang: beneficiary.language, state: beneficiary.conversationState, msgId: msg.id };

  // "Stop" on the announcement template, or STOP typed: no more announcements (WhatsApp opt-out), nothing released.
  if ((input.type === "button" && isAnnouncementStopButton(input.text)) || (input.type === "text" && isStopWord(input.text))) {
    if (beneficiary.announcementsOptInAt || input.type === "button") {
      await getBroadcasts(deps).setOptIn(beneficiary.id, false);
      return sayKey(ctx, "announcements_off");
    }
  }

  // A reviewed explanation (or rejection notice) is waiting behind the opt-in template: any message releases it.
  const heldChat = input.type === "button" ? await hasHeldChat(deps, beneficiary.id) : false;
  await getChat(deps).flushQueued(beneficiary.id); // chatbot answers held behind the 24 h window
  const released = await releaseAwaiting(ctx);
  // Announcements sent as a template outside the 24 h window: the text itself, now that they answered.
  const news = beneficiary.announcementsOptInAt ? await getBroadcasts(deps).releaseFor(beneficiary.id) : 0;
  if ((released || news > 0) && input.type !== "file") return;
  if (input.type === "ignore") return;
  if (input.type === "button") {
    // "Recevoir" tapped on a template: it released what was waiting; if nothing was, show the menu.
    if (!heldChat) await showMainMenu(ctx);
    return;
  }

  await dispatch(ctx, input);
}

/** Chatbot / volunteer answers queued behind the 24 h window (same filter as ChatService.flushQueued). */
async function hasHeldChat(deps: WaDeps, beneficiaryId: string): Promise<boolean> {
  const rows = await deps.db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.beneficiaryId, beneficiaryId), eq(messages.direction, "out"), eq(messages.status, "queued"), eq(messages.chatState, "sent"), isNotNull(messages.author)))
    .limit(1);
  return rows.length > 0;
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
/** A numbered menu: sent as WhatsApp buttons or a list when it fits; typing the number keeps working. */
const sayMenu = (c: Ctx, key: Parameters<typeof waText>[1], params?: Parameters<typeof waText>[2]) =>
  enqueueText(c.deps, c.b.id, waText(c.lang, key, params), { interactive: true });
const setState = async (c: Ctx, s: ConversationState) => {
  c.state = s;
  await c.deps.beneficiaries.setConversationState(c.b.id, s);
};
const showLanguageMenu = async (c: Ctx) => {
  const pendingFile = c.state.step === "choose_language" ? c.state.pendingFile : undefined;
  await setState(c, pendingFile ? { step: "choose_language", pendingFile } : { step: "choose_language" });
  await say(c, `${LANGUAGE_MENU_HEADER}\n\n${waText("fr", "language_menu")}`);
};
const showMainMenu = async (c: Ctx, intro?: Parameters<typeof waText>[1]) => {
  await setState(c, { step: "main_menu" });
  if (intro) await sayKey(c, intro);
  await sayMenu(c, "main_menu");
};
const today = (c: Ctx) => localDate(c.deps.now(), c.deps.config.TIMEZONE);
const buddyCtx = (c: Ctx): BuddyFlowCtx => ({
  deps: c.deps, beneficiaryId: c.b.id, lang: c.lang, state: c.state, web: c.b.web,
  setState: (s) => setState(c, s),
  say: (text, opts) => enqueueText(c.deps, c.b.id, text, opts?.menu ? { interactive: true } : {}),
  showMainMenu: () => showMainMenu(c),
});

// ---------------------------------------------------------------- dispatcher

const helpIo = (c: Ctx): FlowIo => ({
  deps: c.deps, beneficiaryId: c.b.id, lang: c.lang,
  setState: (s) => setState(c, s),
  showMainMenu: () => showMainMenu(c),
});

async function dispatch(c: Ctx, input: Input): Promise<void> {
  if (input.type === "location") {
    if (c.state.step === "choose_language") return showLanguageMenu(c);
    return sendNearby(c, { lat: input.lat, lon: input.lon });
  }
  if (isBuddyStep(c.state)) return onBuddyState(buddyCtx(c), c.state, input);
  if (isHelpState(c.state)) {
    if (input.type === "text" && isMenuWord(input.text)) return showMainMenu(c);
    return onHelpState(helpIo(c), c.state, input.type === "text" ? input.text : null);
  }
  if (isEventState(c.state)) {
    if (input.type === "text" && isMenuWord(input.text)) return showMainMenu(c);
    return onEventState(helpIo(c), c.state, input.type === "text" ? input.text : null);
  }
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
    case "announcements": return onAnnouncements(c, input);
    case "nearby": return onNearby(c, input);
  }
}

async function setLanguageAndGo(c: Ctx, code: LanguageCode): Promise<void> {
  const first = !c.b.languageConfirmed;
  const pending = c.state.step === "choose_language" ? c.state.pendingFile : undefined;
  await c.deps.beneficiaries.setLanguage(c.b.id, code, true);
  c.lang = code;
  c.b = { ...c.b, language: code, languageConfirmed: true };
  if (pending) {
    // A letter photo came before the language: explain it now instead of asking for it again.
    if (first) await sayKey(c, "language_set", { language: LANGUAGES[code].nativeName });
    await setState(c, { step: "main_menu" });
    return onLetterFile(c, { type: "file", ...pending });
  }
  if (first) await sayKey(c, "welcome");
  else await sayKey(c, "language_set", { language: LANGUAGES[code].nativeName });
  await showMainMenu(c);
}

async function onChooseLanguage(c: Ctx, input: Input): Promise<void> {
  if (input.type === "file") {
    // Keep the photo (only its media id) until the person has picked a language; nothing is lost.
    await setState(c, { step: "choose_language", pendingFile: { mediaId: input.mediaId, mime: input.mime } });
    await say(c, `📷 ✅\n${LANGUAGE_MENU_HEADER}\n\n${waText("fr", "language_menu")}`);
    return;
  }
  if (input.type === "text") {
    const n = menuChoice(input.text);
    if (n !== null) {
      const code = LANGUAGE_CODES[Number(n) - 1];
      if (code) return setLanguageAndGo(c, code);
    } else if (input.text.trim().length >= 2) {
      try {
        const det = await withUsageContext(c.b.id, () => c.deps.llm.detectLanguage({ text: input.text }));
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
    if (choice === "3") {
      const out = await c.deps.letters.getOutgoing(c.state.letterId);
      if (out?.details) await say(c, out.details);
    }
    return enqueueText(c.deps, c.b.id, letterOfferText(c.lang), { interactive: true });
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
    case "5": return sendPlaces(c);
    case "6":
      await setState(c, { step: "announcements" });
      return sayMenu(c, c.b.announcementsOptInAt ? "announcements_ask_on" : "announcements_ask", { name: c.deps.config.ASSOCIATION_NAME });
    case "7": return buddyEntry(buddyCtx(c));
    case "8": return startHelp(helpIo(c));
    case "0":
      await setState(c, { step: "main_menu" });
      // Flag the conversation for volunteers ("a volunteer will answer you personally"), and still give the
      // association's contact for people who prefer to call or come.
      await getChat(c.deps).requestHuman(c.b.id);
      return sayKey(c, "human_contact", { name: c.deps.config.ASSOCIATION_NAME, contact: c.deps.config.ASSOCIATION_CONTACT });
    case "9":
      await setState(c, { step: "confirm_delete_all" });
      return sayMenu(c, "delete_confirm");
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
  if (!doc) return sayMenu(c, "main_menu");
  const type = documentTypeName(doc.type, c.lang);
  const date = doc.expiresAt ? formatDate(doc.expiresAt, c.lang) : "—";
  await sayKey(c, "document_saved", { type, date });
  if (doc.expiresAt && doc.expiresAt < today(c)) await say(c, `${waText(c.lang, "document_expired", { type, date })}\n\n${footerFor(c.deps, c.lang)}`);
  await sayMenu(c, "main_menu");
}

// ---------------------------------------------------------------- places & announcements

/** Menu 5: places posted for today (shelter, food, showers…), else "nothing posted" + 115. No review: volunteers' own text. */
async function sendPlaces(c: Ctx): Promise<void> {
  const text = (await getPlaces(c.deps).messageFor(c.lang, { beneficiaryId: c.b.id })) ?? `${waText(c.lang, "places_none")}\n\n${waText(c.lang, "places_115")}`;
  if (c.deps.geo.mode === "off") return say(c, `${text}\n\n${footerFor(c.deps, c.lang)}`);
  // Then: share a location or type an address to get what is nearest (OpenStreetMap, Soliguide).
  await setState(c, { step: "nearby" });
  await say(c, `${text}\n\n${waText(c.lang, "nearby_hint")}\n\n${footerFor(c.deps, c.lang)}`);
}

/**
 * Places nearest to a point. Sent at once rather than through the queue, and recorded in the conversation as a
 * placeholder: the list (names and distances) would tell where the person is, and their location is not kept.
 */
async function sendNearby(c: Ctx, p: LatLon): Promise<void> {
  if (c.deps.geo.mode === "off") return sendPlaces(c);
  if (c.state.step === "nearby") await setState(c, { step: "main_menu" });
  const text = await nearbyMessage(c.deps, p, c.lang, c.b.id);
  await sendTextNow(c.deps, c.b.id, `${text}\n\n${footerFor(c.deps, c.lang)}`, NEARBY_RECORD);
}
const NEARBY_RECORD = "📍 [Lieux proches envoyés. La position et la liste ne sont pas conservées.]";

/** After menu 5: a typed address or landmark (or a shared location, handled above). Anything else: normal flow. */
async function onNearby(c: Ctx, input: Input): Promise<void> {
  if (input.type === "text" && menuChoice(input.text) === null && !isMenuWord(input.text) && looksLikeAddress(input.text)) {
    const p = await c.deps.geo.geocode(input.text);
    if (p) {
      // The address is where the person is: keep only that one was typed.
      const dek = await c.deps.beneficiaries.getDek(c.b.id);
      await c.deps.db.update(messages).set({ bodyEnc: c.deps.crypto.encrypt(dek, "📍 [adresse]") }).where(eq(messages.waMessageId, c.msgId));
      return sendNearby(c, p);
    }
    return sayKey(c, "nearby_not_found"); // stay here: they can type it again or share their location
  }
  await setState(c, { step: "main_menu" });
  return onFreeState(c, input);
}

async function onAnnouncements(c: Ctx, input: Input): Promise<void> {
  const choice = input.type === "text" ? menuChoice(input.text) : null;
  if (choice === "1" || choice === "2") {
    const on = choice === "1";
    await getBroadcasts(c.deps).setOptIn(c.b.id, on);
    c.b = { ...c.b, announcementsOptInAt: on ? c.deps.now() : null };
    await setState(c, { step: "main_menu" });
    await sayKey(c, on ? "announcements_on" : "announcements_off");
    return sayMenu(c, "main_menu");
  }
  // Anything else: back to the normal flow (menu numbers, questions), nothing changed.
  await setState(c, { step: "main_menu" });
  return onFreeState(c, input);
}

// ---------------------------------------------------------------- delete all

/** "Delete all my data" (menu 9 on WhatsApp, or the web space): archived now, destroyed after the retention period. */
export async function deleteAllData(deps: WaDeps, beneficiaryId: string): Promise<void> {
  await getBuddies(deps).endAllForBeneficiary(beneficiaryId); // the buddy can no longer reach them
  await getAppointments(deps).cancelAllFor(beneficiaryId); // before archiving: nothing stays open or scheduled
  await getEvents(deps).removeAllFor(beneficiaryId);
  await deps.beneficiaries.archiveAll(beneficiaryId);
}

async function onConfirmDelete(c: Ctx, input: Input): Promise<void> {
  const choice = input.type === "text" ? menuChoice(input.text) : null;
  if (choice === "1") {
    await setState(c, { step: "main_menu" });
    await say(c, `${waText(c.lang, "delete_done")}\n\n${footerFor(c.deps, c.lang)}`);
    return deleteAllData(c.deps, c.b.id);
  }
  if (choice === "2") return showMainMenu(c);
  return sayMenu(c, "delete_confirm");
}
