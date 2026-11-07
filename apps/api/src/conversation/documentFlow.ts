import { documentTypeName, formatDate, waText } from "@wilson/i18n";
import type { WaDeps } from "../whatsapp/context.js";
import { enqueueText } from "../whatsapp/send.js";

/**
 * To be called by the `document.analyze` worker right after `documents.applyDetection`:
 * asks the beneficiary to confirm the detected type + date (or to type the date) and moves the state machine.
 */
export async function announceDocumentDetection(deps: WaDeps, documentId: string): Promise<void> {
  const doc = await deps.documents.get(documentId);
  if (!doc || doc.archivedAt) return;
  const b = await deps.beneficiaries.get(doc.beneficiaryId);
  if (!b || b.archivedAt) return;
  const type = documentTypeName(doc.type, b.language);
  if (doc.expiresAt) {
    await deps.beneficiaries.setConversationState(b.id, { step: "confirm_document", documentId });
    await enqueueText(deps, b.id, waText(b.language, "document_confirm", { type, date: formatDate(doc.expiresAt, b.language) }), { interactive: true });
  } else {
    await deps.beneficiaries.setConversationState(b.id, { step: "enter_document_date", documentId });
    await enqueueText(deps, b.id, waText(b.language, "document_confirm_no_date", { type }));
  }
}
