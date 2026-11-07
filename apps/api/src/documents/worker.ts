import { eq } from "drizzle-orm";
import { documentTypeName, formatDate, waText } from "@wilson/i18n";
import type { Deps } from "../deps.js";
import { documents } from "../db/schema.js";
import { JOBS, type JobPayloads } from "../jobs/names.js";
import { getServices } from "../services.js";
import { localDate } from "../time.js";
import { withUsageContext } from "../usage/context.js";

/** document.analyze: decrypt → LLM → store detection → ask the beneficiary to confirm in WhatsApp. */
export async function handleDocumentAnalyze(deps: Deps, { documentId }: JobPayloads[typeof JOBS.documentAnalyze]): Promise<void> {
  const { db, llm, crypto, blobs, config, jobs } = deps;
  const { beneficiaries, documents: docs } = getServices(deps);
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.archivedAt || doc.detection) return; // gone, archived, or already analysed (job retry)

  let detection: Parameters<typeof docs.applyDetection>[1];
  try {
    const dek = await beneficiaries.getDek(doc.beneficiaryId);
    const bytes = crypto.decrypt(dek, await blobs.get(doc.objectKey));
    const a = await withUsageContext(doc.beneficiaryId, () => llm.analyzeDocument({ file: { bytes, mimeType: doc.mimeType }, today: localDate(deps.now(), config.TIMEZONE) }));
    detection = { type: a.type, expiresAt: a.expiresAt, confidence: a.confidence, quote: a.expirySourceQuote, promptVersion: a.promptVersion };
  } catch (err) {
    // Never leave the person waiting: fall back to asking for the date by hand; a volunteer can fix the type.
    console.error(`[document.analyze] ${documentId} failed, falling back to manual entry:`, err instanceof Error ? err.message : err);
    detection = { type: "other", expiresAt: null, confidence: 0, quote: null, promptVersion: "analysis-failed" };
  }
  await docs.applyDetection(documentId, detection);

  const ben = await beneficiaries.get(doc.beneficiaryId);
  if (!ben || ben.archivedAt) return;
  const lang = ben.language;
  const type = documentTypeName(detection.type, lang);
  const text = detection.expiresAt
    ? waText(lang, "document_confirm", { type, date: formatDate(detection.expiresAt, lang) })
    : waText(lang, "document_confirm_no_date", { type });
  const body = text + "\n\n" + waText(lang, "footer", { name: config.ASSOCIATION_NAME, contact: config.ASSOCIATION_CONTACT });
  await beneficiaries.setConversationState(ben.id, { step: "confirm_document", documentId });
  await jobs.send(JOBS.waSend, { kind: "text", beneficiaryId: ben.id, body });
}
