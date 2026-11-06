import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { DocumentType } from "@wilson/contracts";
import { documentTypeName, formatDate, waText } from "@wilson/i18n";
import type { Db } from "../db/client.js";
import type { Deps } from "../deps.js";
import { beneficiaries, documents, reminders } from "../db/schema.js";
import { JOBS } from "../jobs/names.js";
import { localDate } from "../time.js";

type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

/** Marks scheduled reminders of these documents as cancelled. */
export async function cancelRemindersFor(db: Executor, documentIds: string[]): Promise<void> {
  if (documentIds.length === 0) return;
  await db
    .update(reminders)
    .set({ status: "cancelled" })
    .where(and(inArray(reminders.documentId, documentIds), eq(reminders.status, "scheduled")));
}

/**
 * Sends every due, still-scheduled reminder exactly once. A reminder is claimed with an atomic
 * `scheduled → sent` update, so concurrent dispatchers or re-runs never double send.
 * Returns the number of reminders enqueued.
 */
export async function dispatchDueReminders(deps: Pick<Deps, "db" | "jobs" | "config">, now: Date): Promise<number> {
  const { db, jobs, config } = deps;
  const due = await db
    .select({
      id: reminders.id,
      kind: reminders.kind,
      docId: documents.id,
      type: documents.type,
      expiresAt: documents.expiresAt,
      archivedAt: documents.archivedAt,
      confirmed: documents.confirmed,
      beneficiaryId: beneficiaries.id,
      language: beneficiaries.language,
      hasKey: beneficiaries.wrappedDek,
      benArchivedAt: beneficiaries.archivedAt,
    })
    .from(reminders)
    .innerJoin(documents, eq(documents.id, reminders.documentId))
    .innerJoin(beneficiaries, eq(beneficiaries.id, documents.beneficiaryId))
    .where(and(eq(reminders.status, "scheduled"), lte(reminders.dueAt, now)));

  const today = localDate(now, config.TIMEZONE);
  let sent = 0;
  for (const r of due) {
    // Stale reminder (document archived / unconfirmed / date removed or already past): cancel instead of sending.
    if (r.archivedAt || r.benArchivedAt || !r.hasKey || !r.confirmed || !r.expiresAt || r.expiresAt < today) {
      await db.update(reminders).set({ status: "cancelled" }).where(and(eq(reminders.id, r.id), eq(reminders.status, "scheduled")));
      continue;
    }
    const claimed = await db
      .update(reminders)
      .set({ status: "sent", sentAt: now })
      .where(and(eq(reminders.id, r.id), eq(reminders.status, "scheduled")))
      .returning({ id: reminders.id });
    if (claimed.length === 0) continue;

    const lang = r.language;
    const body =
      waText(lang, r.kind === "d30" ? "reminder_d30" : "reminder_d7", {
        type: documentTypeName(r.type as DocumentType, lang),
        date: formatDate(r.expiresAt, lang),
      }) +
      "\n\n" +
      waText(lang, "footer", { name: config.ASSOCIATION_NAME, contact: config.ASSOCIATION_CONTACT });
    try {
      await jobs.send(JOBS.waSend, { kind: "text", beneficiaryId: r.beneficiaryId, body, reminderId: r.id }, { singletonKey: `reminder:${r.id}` });
      sent++;
    } catch (err) {
      // Could not enqueue: give the reminder back so the next run retries.
      await db.update(reminders).set({ status: "scheduled", sentAt: null }).where(eq(reminders.id, r.id));
      throw err;
    }
  }
  return sent;
}
