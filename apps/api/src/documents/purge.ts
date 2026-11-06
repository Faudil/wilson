import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { Deps } from "../deps.js";
import { beneficiaries, documents, letters, messages } from "../db/schema.js";
import { getServices } from "../services.js";

async function safeDelete(deps: Pick<Deps, "blobs">, key: string | null): Promise<void> {
  if (!key) return;
  try {
    await deps.blobs.delete(key);
  } catch (err) {
    console.error(`[archive.purge] could not delete blob ${key}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * archive.purge: hard-deletes archived documents past `purge_at`, then beneficiaries past `purge_at`
 * (blobs deleted, wrapped DEK destroyed = crypto-shredding, rows deleted).
 */
export async function purgeArchived(deps: Deps, now: Date): Promise<{ documents: number; beneficiaries: number }> {
  const { db } = deps;

  const dueDocs = await db
    .select({ id: documents.id, key: documents.objectKey })
    .from(documents)
    .where(and(isNotNull(documents.purgeAt), lte(documents.purgeAt, now)));
  for (const d of dueDocs) {
    await safeDelete(deps, d.key);
    await db.delete(documents).where(eq(documents.id, d.id));
  }

  const dueBens = await db
    .select({ id: beneficiaries.id })
    .from(beneficiaries)
    .where(and(isNotNull(beneficiaries.purgeAt), lte(beneficiaries.purgeAt, now)));
  for (const b of dueBens) {
    for (const d of await db.select({ key: documents.objectKey }).from(documents).where(eq(documents.beneficiaryId, b.id))) await safeDelete(deps, d.key);
    for (const l of await db.select({ key: letters.photoKey }).from(letters).where(eq(letters.beneficiaryId, b.id))) await safeDelete(deps, l.key);
    for (const m of await db.select({ key: messages.mediaKey }).from(messages).where(eq(messages.beneficiaryId, b.id))) await safeDelete(deps, m.key);
    // Destroy the key first (crypto-shredding), then remove the rows (cascades to documents, letters, messages, reminders).
    await db.update(beneficiaries).set({ wrappedDek: null }).where(eq(beneficiaries.id, b.id));
    getServices(deps).beneficiaries.forgetDek(b.id);
    await db.delete(beneficiaries).where(eq(beneficiaries.id, b.id));
  }
  return { documents: dueDocs.length, beneficiaries: dueBens.length };
}
