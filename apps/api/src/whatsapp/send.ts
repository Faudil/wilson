import { and, eq, ne } from "drizzle-orm";
import { documentTypeName, formatDate, waText } from "@wilson/i18n";
import { JOBS, type JobPayloads } from "../jobs/names.js";
import { messages, reminders } from "../db/schema.js";
import type { ConversationState } from "../db/schema.js";
import type { WaDeps } from "./context.js";

const WINDOW_MS = 24 * 3600 * 1000;

/** The only way anything is sent to a beneficiary: enqueue a wa.send job (tests assert on the queue). */
export function enqueueText(deps: Pick<WaDeps, "jobs">, beneficiaryId: string, body: string, extra: { letterId?: string; reminderId?: string } = {}): Promise<void> {
  return deps.jobs.send(JOBS.waSend, { kind: "text", beneficiaryId, body, ...extra });
}

/** Footer appended to messages that must carry the orientation pointer. */
export function footerFor(deps: Pick<WaDeps, "config">, lang: Parameters<typeof waText>[0]): string {
  return waText(lang, "footer", { name: deps.config.ASSOCIATION_NAME, contact: deps.config.ASSOCIATION_CONTACT });
}

async function storeOutbound(deps: WaDeps, beneficiaryId: string, kind: "text" | "template", body: string, waMessageId: string): Promise<void> {
  // The sandbox transport records its own rows; only real transports are recorded here.
  if (deps.wa.mode === "sandbox") return;
  const dek = await deps.beneficiaries.getDek(beneficiaryId);
  await deps.db.insert(messages).values({
    beneficiaryId, direction: "out", kind, waMessageId, bodyEnc: deps.crypto.encrypt(dek, body), status: "sent",
  }).onConflictDoNothing();
}

/** States in which it is safe to switch to "offer to save the letter" after a reply was delivered. */
const OFFER_OK: ConversationState["step"][] = ["main_menu", "await_letter_photo", "await_document_file", "offer_save_letter"];

export async function runSendJob(deps: WaDeps, payload: JobPayloads[typeof JOBS.waSend]): Promise<void> {
  const { beneficiaries, letters, wa, config } = deps;

  if (payload.kind === "letter_reply") {
    const out = await letters.getOutgoing(payload.letterId);
    // Idempotent: only an approved letter is sent; a retried or duplicated job is a no-op.
    if (!out || out.status !== "approved" || !out.text) return;
    const b = await beneficiaries.get(out.beneficiaryId);
    if (!b) return;
    const to = await beneficiaries.getWaId(b.id);
    if (!windowOpen(deps, b.lastInboundAt)) {
      if (!out.awaitingOptIn) {
        const { waMessageId } = await wa.sendTemplate(to, config.WHATSAPP_TEMPLATE_EXPLANATION_READY, b.language, []);
        await storeOutbound(deps, b.id, "template", `[template ${config.WHATSAPP_TEMPLATE_EXPLANATION_READY}]`, waMessageId);
        await letters.setAwaitingOptIn(out.letterId, true);
      }
      return;
    }
    const { waMessageId } = await wa.sendText(to, out.text);
    await storeOutbound(deps, b.id, "text", out.text, waMessageId);
    await letters.markSent(out.letterId);
    if (OFFER_OK.includes(b.conversationState.step)) {
      await beneficiaries.setConversationState(b.id, { step: "offer_save_letter", letterId: out.letterId });
      await enqueueText(deps, b.id, waText(b.language, "letter_offer_save"));
    }
    return;
  }

  if (payload.kind === "chat") return runChatSend(deps, payload.messageId);

  const b = await beneficiaries.get(payload.beneficiaryId);
  if (!b) return;
  const to = await beneficiaries.getWaId(b.id);
  if (!windowOpen(deps, b.lastInboundAt)) {
    if (payload.reminderId) {
      const [rem] = await deps.db.select({ documentId: reminders.documentId }).from(reminders).where(eq(reminders.id, payload.reminderId)).limit(1);
      const doc = rem ? await deps.documents.get(rem.documentId) : null;
      const params = doc ? [documentTypeName(doc.type, b.language), doc.expiresAt ? formatDate(doc.expiresAt, b.language) : ""] : null;
      if (params) {
        const { waMessageId } = await wa.sendTemplate(to, config.WHATSAPP_TEMPLATE_DOCUMENT_REMINDER, b.language, params);
        await storeOutbound(deps, b.id, "template", `[template ${config.WHATSAPP_TEMPLATE_DOCUMENT_REMINDER}] ${params.join(" | ")}`, waMessageId);
        return;
      }
    } else if (payload.letterId) {
      // e.g. "a volunteer will contact you" after the window closed: ask for an opt-in, released on the next inbound message.
      const { waMessageId } = await wa.sendTemplate(to, config.WHATSAPP_TEMPLATE_EXPLANATION_READY, b.language, []);
      await storeOutbound(deps, b.id, "template", `[template ${config.WHATSAPP_TEMPLATE_EXPLANATION_READY}]`, waMessageId);
      await letters.setAwaitingOptIn(payload.letterId, true);
      return;
    }
  }
  const { waMessageId } = await wa.sendText(to, payload.body);
  await storeOutbound(deps, b.id, "text", payload.body, waMessageId);
}

/**
 * Chatbot message: the row already exists (created by ChatService, footer included). Send it, then give the row the
 * transport's message id and drop the duplicate row the sandbox transport recorded. Outside the 24 h window the
 * message stays queued behind an opt-in template and is re-queued on the next inbound message (ChatService.flushQueued).
 */
async function runChatSend(deps: WaDeps, messageId: string): Promise<void> {
  const { beneficiaries, wa, config, db, crypto } = deps;
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  // Idempotent: only a queued, released message is sent (drafts and rejected ones never are).
  if (!m || m.status !== "queued" || m.chatState !== "sent" || !m.bodyEnc) return;
  const b = await beneficiaries.get(m.beneficiaryId);
  if (!b) return;
  const to = await beneficiaries.getWaId(b.id);
  if (!windowOpen(deps, b.lastInboundAt)) {
    const { waMessageId } = await wa.sendTemplate(to, config.WHATSAPP_TEMPLATE_EXPLANATION_READY, b.language, []);
    await storeOutbound(deps, b.id, "template", `[template ${config.WHATSAPP_TEMPLATE_EXPLANATION_READY}]`, waMessageId);
    return;
  }
  const dek = await beneficiaries.getDek(b.id);
  const { waMessageId } = await wa.sendText(to, crypto.decrypt(dek, m.bodyEnc).toString("utf8"));
  await db.delete(messages).where(and(eq(messages.waMessageId, waMessageId), ne(messages.id, m.id)));
  await db.update(messages).set({ waMessageId, status: "sent" }).where(eq(messages.id, m.id));
}

function windowOpen(deps: WaDeps, lastInboundAt: Date | null): boolean {
  if (deps.wa.mode === "sandbox") return true;
  return !!lastInboundAt && deps.now().getTime() - lastInboundAt.getTime() < WINDOW_MS;
}
