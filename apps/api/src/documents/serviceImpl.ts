import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DocumentDto, DocumentType } from "@wilson/contracts";
import type { BeneficiariesServiceImpl } from "../beneficiaries/serviceImpl.js";
import type { Deps } from "../deps.js";
import { documents, letters, reminders } from "../db/schema.js";
import { JOBS } from "../jobs/names.js";
import { addDays, localDate, zonedTime } from "../time.js";
import type { DocumentsService } from "./service.js";
import { cancelRemindersFor } from "./reminders.js";

type DocRow = typeof documents.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;

const REMINDERS = [
  { kind: "d30", daysBefore: 30 },
  { kind: "d7", daysBefore: 7 },
] as const;
const REMINDER_HOUR = 10;

export interface DocumentEdit {
  type?: DocumentType;
  label?: string | null;
  expiresAt?: string | null;
}

export class DocumentsServiceImpl implements DocumentsService {
  constructor(
    private readonly deps: Pick<Deps, "db" | "crypto" | "blobs" | "jobs" | "config" | "now">,
    private readonly bens: BeneficiariesServiceImpl,
  ) {}

  async createFromUpload(input: { beneficiaryId: string; bytes: Buffer; mimeType: string; type?: DocumentType }) {
    const { db, crypto, blobs, jobs } = this.deps;
    const dek = await this.bens.getDek(input.beneficiaryId);
    const id = randomUUID();
    const objectKey = `documents/${input.beneficiaryId}/${id}`;
    await blobs.put(objectKey, crypto.encrypt(dek, input.bytes), "application/octet-stream");
    await db.insert(documents).values({
      id,
      beneficiaryId: input.beneficiaryId,
      type: input.type ?? "other",
      objectKey,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
    });
    await jobs.send(JOBS.documentAnalyze, { documentId: id });
    return { documentId: id };
  }

  async createFromLetter(input: { letterId: string }) {
    const { db, crypto, blobs } = this.deps;
    const [letter] = await db.select().from(letters).where(eq(letters.id, input.letterId));
    if (!letter) throw new Error(`letter not found: ${input.letterId}`);
    if (!letter.photoKey) throw new Error(`letter ${input.letterId} has no photo to save`);
    const dek = await this.bens.getDek(letter.beneficiaryId);
    const id = randomUUID();
    const objectKey = `documents/${letter.beneficiaryId}/${id}`;
    // Same DEK: the ciphertext is copied as is; we decrypt once to record size + hash (and prove the key works).
    const plain = crypto.decrypt(dek, await blobs.get(letter.photoKey));
    await blobs.copy(letter.photoKey, objectKey);
    await db.insert(documents).values({
      id,
      beneficiaryId: letter.beneficiaryId,
      type: "letter",
      confirmed: true,
      objectKey,
      mimeType: letter.photoMime ?? "image/jpeg",
      sizeBytes: plain.length,
      sha256: createHash("sha256").update(plain).digest("hex"),
    });
    return { documentId: id };
  }

  async applyDetection(
    documentId: string,
    d: { type: DocumentType; expiresAt: string | null; confidence: number; quote: string | null; promptVersion: string },
  ) {
    await this.deps.db
      .update(documents)
      .set({
        type: d.type,
        expiresAt: d.expiresAt,
        expirySource: d.expiresAt ? "detected" : null,
        detection: { confidence: d.confidence, quote: d.quote, promptVersion: d.promptVersion },
      })
      .where(eq(documents.id, documentId));
  }

  async confirm(documentId: string) {
    await this.deps.db.update(documents).set({ confirmed: true }).where(eq(documents.id, documentId));
    await this.scheduleReminders(documentId);
  }

  async setExpiry(documentId: string, expiresAt: string | null, source: "entered_by_user" | "entered_by_volunteer") {
    await this.deps.db
      .update(documents)
      .set({ expiresAt, expirySource: expiresAt ? source : null })
      .where(eq(documents.id, documentId));
    await this.scheduleReminders(documentId);
  }

  /** Volunteer edit from the back-office (type / label / expiry). Returns null if the document does not exist. */
  async update(documentId: string, edit: DocumentEdit, source: "entered_by_user" | "entered_by_volunteer" = "entered_by_volunteer") {
    const [doc] = await this.deps.db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return null;
    const set: Partial<typeof documents.$inferInsert> = {};
    if (edit.type !== undefined) set.type = edit.type;
    if (edit.label !== undefined) {
      const dek = await this.bens.getDek(doc.beneficiaryId);
      set.labelEnc = edit.label === null ? null : this.deps.crypto.encrypt(dek, edit.label);
    }
    if (edit.expiresAt !== undefined) {
      set.expiresAt = edit.expiresAt;
      set.expirySource = edit.expiresAt ? source : null;
    }
    if (Object.keys(set).length) await this.deps.db.update(documents).set(set).where(eq(documents.id, documentId));
    if (edit.expiresAt !== undefined) await this.scheduleReminders(documentId);
    return this.get(documentId);
  }

  /** Cancels scheduled reminders then recreates d30/d7 for confirmed, non-archived documents with a future due time. */
  async scheduleReminders(documentId: string): Promise<void> {
    const { db, config } = this.deps;
    const now = this.deps.now();
    await db.transaction(async (tx) => {
      await cancelRemindersFor(tx, [documentId]);
      const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
      if (!doc || !doc.confirmed || doc.archivedAt || !doc.expiresAt) return;
      const rows = REMINDERS.flatMap((r) => {
        const dueAt = zonedTime(addDays(doc.expiresAt!, -r.daysBefore), REMINDER_HOUR, config.TIMEZONE);
        return dueAt.getTime() > now.getTime() ? [{ documentId, kind: r.kind, dueAt }] : [];
      });
      if (rows.length) await tx.insert(reminders).values(rows);
    });
  }

  async get(documentId: string) {
    const [doc] = await this.deps.db.select().from(documents).where(eq(documents.id, documentId));
    return doc ? (await this.toDtos([doc]))[0]! : null;
  }

  async listForBeneficiary(beneficiaryId: string) {
    const rows = await this.deps.db
      .select()
      .from(documents)
      .where(and(eq(documents.beneficiaryId, beneficiaryId), isNull(documents.archivedAt), eq(documents.confirmed, true)))
      .orderBy(sql`${documents.expiresAt} asc nulls last`, asc(documents.createdAt));
    return this.toDtos(rows);
  }

  /** Everything the volunteer can see for a beneficiary: confirmed or not, archived included (flagged). */
  async listAllForBeneficiary(beneficiaryId: string) {
    const rows = await this.deps.db
      .select()
      .from(documents)
      .where(eq(documents.beneficiaryId, beneficiaryId))
      .orderBy(sql`${documents.expiresAt} asc nulls last`, asc(documents.createdAt));
    return this.toDtos(rows);
  }

  async archive(documentId: string) {
    const { db, config } = this.deps;
    const now = this.deps.now();
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ archivedAt: now, purgeAt: new Date(now.getTime() + config.ARCHIVE_RETENTION_DAYS * 86_400_000) })
        .where(and(eq(documents.id, documentId), isNull(documents.archivedAt)));
      await cancelRemindersFor(tx, [documentId]);
    });
    const dto = await this.get(documentId);
    if (!dto) throw new Error(`document not found: ${documentId}`);
    return dto;
  }

  async readFile(documentId: string) {
    const [doc] = await this.deps.db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) throw new Error(`document not found: ${documentId}`);
    const dek = await this.bens.getDek(doc.beneficiaryId);
    const bytes = this.deps.crypto.decrypt(dek, await this.deps.blobs.get(doc.objectKey));
    return { bytes, mimeType: doc.mimeType };
  }

  /** Confirmed, non-archived documents expiring between `today - graceDays` and `today + withinDays`. */
  async deadlines(withinDays: number, graceDays = 30) {
    const today = localDate(this.deps.now(), this.deps.config.TIMEZONE);
    return this.deps.db
      .select({ id: documents.id, beneficiaryId: documents.beneficiaryId, type: documents.type, expiresAt: documents.expiresAt })
      .from(documents)
      .where(
        and(
          eq(documents.confirmed, true),
          isNull(documents.archivedAt),
          isNotNull(documents.expiresAt),
          sql`${documents.expiresAt} <= ${addDays(today, withinDays)}::date`,
          sql`${documents.expiresAt} >= ${addDays(today, -graceDays)}::date`,
        ),
      )
      .orderBy(asc(documents.expiresAt));
  }

  private async toDtos(rows: DocRow[]): Promise<DocumentDto[]> {
    if (rows.length === 0) return [];
    const rem = await this.deps.db
      .select()
      .from(reminders)
      .where(inArray(reminders.documentId, rows.map((r) => r.id)))
      .orderBy(asc(reminders.dueAt));
    const byDoc = new Map<string, ReminderRow[]>();
    for (const r of rem) byDoc.set(r.documentId, [...(byDoc.get(r.documentId) ?? []), r]);
    const out: DocumentDto[] = [];
    for (const d of rows) {
      let label: string | null = null;
      if (d.labelEnc) {
        const dek = await this.bens.getDek(d.beneficiaryId);
        label = this.deps.crypto.decrypt(dek, d.labelEnc).toString("utf8");
      }
      out.push({
        id: d.id,
        beneficiaryId: d.beneficiaryId,
        type: d.type as DocumentType,
        label,
        expiresAt: d.expiresAt,
        expirySource: d.expirySource as DocumentDto["expirySource"],
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        createdAt: d.createdAt.toISOString(),
        archivedAt: d.archivedAt?.toISOString() ?? null,
        purgeAt: d.purgeAt?.toISOString() ?? null,
        reminders: (byDoc.get(d.id) ?? [])
          .filter((r) => r.status !== "cancelled")
          .map((r) => ({ id: r.id, kind: r.kind, dueAt: r.dueAt.toISOString(), status: r.status, sentAt: r.sentAt?.toISOString() ?? null })),
      });
    }
    return out;
  }
}
