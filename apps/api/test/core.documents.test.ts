import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { documentTypeName, formatDate } from "@wilson/i18n";
import { beneficiaries, documents, letters, reminders } from "../src/db/schema.js";
import { dispatchDueReminders } from "../src/documents/reminders.js";
import { purgeArchived } from "../src/documents/purge.js";
import { handleDocumentAnalyze } from "../src/documents/worker.js";
import { JOBS } from "../src/jobs/names.js";
import { makeTestDeps, PNG_BYTES, type TestCtx } from "./helpers.js";

let t: TestCtx;
beforeAll(async () => {
  t = await makeTestDeps({ now: "2026-11-06T12:00:00Z" });
});
afterAll(async () => {
  await t.close();
});

let benId: string;
let n = 0;
beforeEach(async () => {
  t.clock.set("2026-11-06T12:00:00Z");
  t.queue.clear();
  t.wa.texts.length = 0;
  await t.deps.db.delete(beneficiaries); // cascades to documents/reminders/letters
  const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(`3361234${String(5600 + ++n).padStart(4, "0")}`);
  benId = beneficiary.id;
  await t.services.beneficiaries.setLanguage(benId, "fr", true);
});

const remindersOf = (documentId: string, status?: "scheduled" | "sent" | "cancelled") =>
  t.deps.db
    .select()
    .from(reminders)
    .where(status ? and(eq(reminders.documentId, documentId), eq(reminders.status, status)) : eq(reminders.documentId, documentId))
    .orderBy(reminders.dueAt);

async function savedDoc(expiry: string | null = "2027-04-20") {
  const { documentId } = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
  await t.services.documents.applyDetection(documentId, { type: "recepisse", expiresAt: expiry, confidence: 0.9, quote: null, promptVersion: "t" });
  await t.services.documents.confirm(documentId);
  return documentId;
}

describe("beneficiaries", () => {
  it("creates once per wa_id, masks the label, decrypts the wa_id", async () => {
    const a = await t.services.beneficiaries.findOrCreateByWaId("33699999921");
    const b = await t.services.beneficiaries.findOrCreateByWaId("33699999921");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.beneficiary.id).toBe(a.beneficiary.id);
    expect(await t.services.beneficiaries.label(a.beneficiary.id)).toBe("•• •• •• •• 21");
    expect(await t.services.beneficiaries.getWaId(a.beneficiary.id)).toBe("33699999921");
    const [row] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, a.beneficiary.id));
    expect(row!.waIdEnc.includes(Buffer.from("33699999921"))).toBe(false);
  });
});

describe("documents", () => {
  it("encrypts the blob with the beneficiary DEK and queues analysis", async () => {
    const { documentId } = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
    const [doc] = await t.deps.db.select().from(documents).where(eq(documents.id, documentId));
    const stored = await t.blobs.get(doc!.objectKey);
    expect(stored.includes(PNG_BYTES)).toBe(false);
    expect(doc!.objectKey).toBe(`documents/${benId}/${documentId}`);
    expect(doc!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc!.confirmed).toBe(false);
    expect(t.queue.jobs(JOBS.documentAnalyze)).toEqual([{ documentId }]);
    expect((await t.services.documents.readFile(documentId)).bytes.equals(PNG_BYTES)).toBe(true);
  });

  it("document.analyze applies detection, asks for confirmation and sets the conversation state", async () => {
    t.llm.nextDocument = { promptVersion: "stub@1", type: "recepisse", expiresAt: "2027-03-14", expirySourceQuote: "q", confidence: 0.9 };
    const { documentId } = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
    await handleDocumentAnalyze(t.deps, { documentId });
    const dto = await t.services.documents.get(documentId);
    expect(dto).toMatchObject({ type: "recepisse", expiresAt: "2027-03-14", expirySource: "detected" });
    expect(await t.services.documents.listForBeneficiary(benId)).toHaveLength(0); // not confirmed yet
    const sends = t.queue.jobs(JOBS.waSend);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    expect(send).toMatchObject({ kind: "text", beneficiaryId: benId });
    if (send.kind === "text") {
      expect(send.body).toContain(formatDate("2027-03-14", "fr"));
      expect(send.body).toContain(documentTypeName("recepisse", "fr"));
    }
    expect((await t.services.beneficiaries.get(benId))!.conversationState).toEqual({ step: "confirm_document", documentId });
    // retry of the same job is a no-op
    await handleDocumentAnalyze(t.deps, { documentId });
    expect(t.llm.documentCalls).toBeGreaterThan(0);
    expect(t.queue.jobs(JOBS.waSend)).toHaveLength(1);
  });

  it("document.analyze without a date uses the no_date message; LLM failure falls back to manual", async () => {
    t.llm.nextDocument = { promptVersion: "stub@1", type: "domiciliation", expiresAt: null, expirySourceQuote: null, confidence: 0.5 };
    const a = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
    await handleDocumentAnalyze(t.deps, { documentId: a.documentId });
    expect((await t.services.documents.get(a.documentId))!.expiresAt).toBeNull();
    t.llm.failDocument = true;
    const b = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
    await handleDocumentAnalyze(t.deps, { documentId: b.documentId });
    t.llm.failDocument = false;
    expect((await t.services.documents.get(b.documentId))!.type).toBe("other");
    expect(t.queue.jobs(JOBS.waSend)).toHaveLength(2);
  });

  it("confirm schedules d30 and d7 at 10:00 Europe/Paris (DST aware)", async () => {
    const id = await savedDoc("2027-04-20");
    const rs = await remindersOf(id);
    expect(rs.map((r) => r.kind)).toEqual(["d30", "d7"]);
    expect(rs[0]!.dueAt.toISOString()).toBe("2027-03-21T09:00:00.000Z"); // CET, UTC+1
    expect(rs[1]!.dueAt.toISOString()).toBe("2027-04-13T08:00:00.000Z"); // CEST, UTC+2
    const dto = await t.services.documents.get(id);
    expect(dto!.reminders.map((r) => r.status)).toEqual(["scheduled", "scheduled"]);
  });

  it("no reminders for unconfirmed docs or docs without expiry; past reminders are skipped", async () => {
    const { documentId } = await t.services.documents.createFromUpload({ beneficiaryId: benId, bytes: PNG_BYTES, mimeType: "image/png" });
    await t.services.documents.setExpiry(documentId, "2027-04-20", "entered_by_user");
    expect(await remindersOf(documentId)).toHaveLength(0);
    const noExpiry = await savedDoc(null);
    expect(await remindersOf(noExpiry)).toHaveLength(0);
    const soon = await savedDoc("2026-11-20"); // d30 already past, d7 = 2026-11-13
    const rs = await remindersOf(soon);
    expect(rs.map((r) => r.kind)).toEqual(["d7"]);
    const expired = await savedDoc("2026-10-01");
    expect(await remindersOf(expired)).toHaveLength(0);
  });

  it("setExpiry cancels and recreates reminders", async () => {
    const id = await savedDoc("2027-04-20");
    const before = await remindersOf(id, "scheduled");
    await t.services.documents.setExpiry(id, "2027-06-01", "entered_by_volunteer");
    const cancelled = await remindersOf(id, "cancelled");
    const after = await remindersOf(id, "scheduled");
    expect(cancelled.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.map((r) => r.dueAt.toISOString())).toEqual(["2027-05-02T08:00:00.000Z", "2027-05-25T08:00:00.000Z"]);
    expect((await t.services.documents.get(id))!.expirySource).toBe("entered_by_volunteer");
    await t.services.documents.setExpiry(id, null, "entered_by_user");
    expect(await remindersOf(id, "scheduled")).toHaveLength(0);
  });

  it("archive cancels reminders, hides the document and sets purgeAt = now + 30 days", async () => {
    const id = await savedDoc("2027-04-20");
    const dto = await t.services.documents.archive(id);
    expect(dto.archivedAt).toBe("2026-11-06T12:00:00.000Z");
    expect(dto.purgeAt).toBe("2026-12-06T12:00:00.000Z");
    expect(await remindersOf(id, "scheduled")).toHaveLength(0);
    expect((await t.services.documents.listForBeneficiary(benId)).map((d) => d.id)).not.toContain(id);
    // archive is idempotent: purgeAt does not slide
    t.clock.set("2026-11-10T12:00:00Z");
    expect((await t.services.documents.archive(id)).purgeAt).toBe("2026-12-06T12:00:00.000Z");
  });

  it("dispatchDueReminders sends each reminder exactly once, in the beneficiary's language", async () => {
    await t.services.beneficiaries.setLanguage(benId, "en", true);
    const id = await savedDoc("2027-04-20");
    expect(await dispatchDueReminders(t.deps, new Date("2027-03-21T08:59:00Z"))).toBe(0);
    expect(await dispatchDueReminders(t.deps, new Date("2027-03-21T09:00:00Z"))).toBe(1);
    expect(await dispatchDueReminders(t.deps, new Date("2027-03-21T09:15:00Z"))).toBe(0);
    const sends = t.queue.jobs(JOBS.waSend);
    expect(sends).toHaveLength(1);
    const [d30] = await remindersOf(id);
    const s = sends[0]!;
    expect(s.kind).toBe("text");
    if (s.kind === "text") {
      expect(s.reminderId).toBe(d30!.id);
      expect(s.beneficiaryId).toBe(benId);
      expect(s.body).toContain(formatDate("2027-04-20", "en"));
      expect(s.body).toContain(documentTypeName("recepisse", "en"));
      expect(s.body).toContain(t.config.ASSOCIATION_CONTACT);
    }
    expect(d30!.status).toBe("sent");
    expect(d30!.sentAt).not.toBeNull();
    expect(await dispatchDueReminders(t.deps, new Date("2027-04-13T08:00:00Z"))).toBe(1);
    expect(t.queue.jobs(JOBS.waSend)).toHaveLength(2);
  });

  it("does not send reminders of archived documents", async () => {
    const id = await savedDoc("2027-04-20");
    await t.services.documents.archive(id);
    expect(await dispatchDueReminders(t.deps, new Date("2027-05-01T00:00:00Z"))).toBe(0);
    expect(t.queue.jobs(JOBS.waSend)).toHaveLength(0);
  });

  it("purge removes archived documents and blobs only after 30 days", async () => {
    const id = await savedDoc("2027-04-20");
    const keep = await savedDoc("2027-04-21");
    const [doc] = await t.deps.db.select().from(documents).where(eq(documents.id, id));
    await t.services.documents.archive(id);
    expect(await purgeArchived(t.deps, new Date("2026-12-05T12:00:00Z"))).toEqual({ documents: 0, beneficiaries: 0 });
    expect(t.blobs.has(doc!.objectKey)).toBe(true);
    expect(await purgeArchived(t.deps, new Date("2026-12-06T12:00:01Z"))).toEqual({ documents: 1, beneficiaries: 0 });
    expect(t.blobs.has(doc!.objectKey)).toBe(false);
    expect(await t.services.documents.get(id)).toBeNull();
    expect(await remindersOf(id)).toHaveLength(0);
    expect(await t.services.documents.get(keep)).not.toBeNull();
  });

  it("'delete all my data' archives everything, then crypto-shreds and purges after 30 days", async () => {
    const id = await savedDoc("2027-04-20");
    const [doc] = await t.deps.db.select().from(documents).where(eq(documents.id, id));
    await t.services.beneficiaries.archiveAll(benId);
    expect((await t.services.beneficiaries.get(benId))!.archivedAt).not.toBeNull();
    expect(await remindersOf(id, "scheduled")).toHaveLength(0);
    expect(await purgeArchived(t.deps, new Date("2026-11-20T00:00:00Z"))).toEqual({ documents: 0, beneficiaries: 0 });
    const res = await purgeArchived(t.deps, new Date("2026-12-07T00:00:00Z"));
    expect(res.beneficiaries).toBe(1);
    expect(t.blobs.has(doc!.objectKey)).toBe(false);
    expect(await t.services.beneficiaries.get(benId)).toBeNull();
    await expect(t.services.beneficiaries.getDek(benId)).rejects.toThrow();
  });

  it("createFromLetter copies the encrypted photo into a confirmed 'letter' document", async () => {
    const dek = await t.services.beneficiaries.getDek(benId);
    await t.blobs.put("tmp/letters/L1", t.deps.crypto.encrypt(dek, PNG_BYTES));
    const [l] = await t.deps.db.insert(letters).values({ beneficiaryId: benId, photoKey: "tmp/letters/L1", photoMime: "image/png" }).returning();
    const { documentId } = await t.services.documents.createFromLetter({ letterId: l!.id });
    const dto = await t.services.documents.get(documentId);
    expect(dto).toMatchObject({ type: "letter", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    expect((await t.services.documents.listForBeneficiary(benId)).map((d) => d.id)).toContain(documentId);
    expect((await t.services.documents.readFile(documentId)).bytes.equals(PNG_BYTES)).toBe(true);
  });
});
