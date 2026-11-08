import { eq, and, isNull, sql } from "drizzle-orm";
import { isBsuid, type LanguageCode } from "@wilson/contracts";
import type { Deps } from "../deps.js";
import { beneficiaries, documents, type ConversationState } from "../db/schema.js";
import { cancelRemindersFor } from "../documents/reminders.js";
import type { BeneficiariesService, BeneficiaryRow } from "./service.js";

const DEK_TTL_MS = 5 * 60_000;
const LABEL_MASK = "•• •• •• ••";
/** Last 2 digits for the masked label; a BSUID has no phone digits to show. */
const last2 = (waId: string): string => (isBsuid(waId) ? "••" : waId.replace(/\D/g, "").slice(-2));

type Row = typeof beneficiaries.$inferSelect;
const toRow = (r: Row): BeneficiaryRow => ({
  id: r.id,
  language: r.language,
  languageConfirmed: r.languageConfirmed,
  conversationState: r.conversationState,
  lastInboundAt: r.lastInboundAt,
  archivedAt: r.archivedAt,
  announcementsOptInAt: r.announcementsOptInAt,
  createdAt: r.createdAt,
  guardStatus: r.guardStatus as BeneficiaryRow["guardStatus"],
});

export class BeneficiariesServiceImpl implements BeneficiariesService {
  private readonly deks = new Map<string, { dek: Buffer; expires: number }>();

  constructor(private readonly deps: Pick<Deps, "db" | "crypto" | "config" | "now">) {}

  async findOrCreateByWaId(waId: string, userId?: string) {
    const { db, crypto } = this.deps;
    const hash = crypto.lookupHash(waId);
    const userHash = userId ? crypto.lookupHash(userId) : isBsuid(waId) ? hash : null;
    let [existing] = await db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, hash));
    if (!existing && userHash) {
      // Same person, other address: first seen without their number (BSUID only), or the number is hidden now.
      [existing] = await db.select().from(beneficiaries).where(eq(beneficiaries.userIdHash, userHash))
        .orderBy(sql`${beneficiaries.archivedAt} asc nulls first`).limit(1);
      if (existing && !existing.archivedAt && !isBsuid(waId)) {
        // The phone number is now visible: keep it, it works for every message type (BSUIDs do not, e.g. some templates).
        await this.setAddress(existing.id, waId);
        existing = { ...existing, waIdHash: hash };
      }
    }
    if (existing && !existing.archivedAt) {
      if (userHash && existing.userIdHash !== userHash) {
        await db.update(beneficiaries).set({ userIdHash: userHash }).where(eq(beneficiaries.id, existing.id));
      }
      return { beneficiary: toRow(existing), created: false };
    }
    if (existing) {
      // The person asked to delete everything and writes again: start over as a new person. The archived row is
      // detached from this number (its hash is no longer a lookup hash) and still purged on schedule.
      await db.update(beneficiaries).set({ waIdHash: `archived:${existing.id}`, userIdHash: null }).where(eq(beneficiaries.id, existing.id));
    }

    const { dek, wrapped } = crypto.newDek();
    const inserted = await db
      .insert(beneficiaries)
      .values({
        waIdHash: hash, waIdEnc: crypto.encrypt(dek, waId), waIdLast2: last2(waId), userIdHash: userHash, wrappedDek: wrapped,
        createdAt: this.deps.now(), // the flood guard compares it with the injectable clock
        // A blocked number stays blocked even after "delete my data".
        ...(existing?.guardStatus === "blocked" ? { guardStatus: "blocked" as const, guardReason: existing.guardReason, guardAt: existing.guardAt } : {}),
      })
      .onConflictDoNothing({ target: beneficiaries.waIdHash })
      .returning();
    if (inserted[0]) {
      this.deks.set(inserted[0].id, { dek, expires: this.deps.now().getTime() + DEK_TTL_MS });
      return { beneficiary: toRow(inserted[0]), created: true };
    }
    // Lost a race with a concurrent first message.
    const [row] = await db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, hash));
    return { beneficiary: toRow(row!), created: false };
  }

  async changeIdentity(from: { waId?: string; userId?: string }, to: { waId?: string; userId?: string }): Promise<boolean> {
    const { db, crypto } = this.deps;
    const live = isNull(beneficiaries.archivedAt);
    const find = async (col: typeof beneficiaries.waIdHash | typeof beneficiaries.userIdHash, id?: string) =>
      id ? (await db.select().from(beneficiaries).where(and(eq(col, crypto.lookupHash(id)), live)).limit(1))[0] : undefined;
    const row = (await find(beneficiaries.waIdHash, from.waId)) ?? (await find(beneficiaries.userIdHash, from.userId))
      ?? (await find(beneficiaries.waIdHash, from.userId));
    if (!row) return false;
    if (to.waId) {
      const taken = await find(beneficiaries.waIdHash, to.waId);
      if (taken && taken.id !== row.id) return false; // never merge two people
      await this.setAddress(row.id, to.waId);
    } else if (to.userId && isBsuid(crypto.decrypt(await this.getDek(row.id), row.waIdEnc).toString("utf8"))) {
      await this.setAddress(row.id, to.userId); // we only knew the old BSUID: it no longer reaches them
    }
    if (to.userId) await db.update(beneficiaries).set({ userIdHash: crypto.lookupHash(to.userId) }).where(eq(beneficiaries.id, row.id));
    return true;
  }

  private async setAddress(id: string, waId: string): Promise<void> {
    const { db, crypto } = this.deps;
    const dek = await this.getDek(id);
    await db.update(beneficiaries)
      .set({ waIdHash: crypto.lookupHash(waId), waIdEnc: crypto.encrypt(dek, waId), waIdLast2: last2(waId) })
      .where(eq(beneficiaries.id, id));
  }

  async get(id: string) {
    const [r] = await this.deps.db.select().from(beneficiaries).where(eq(beneficiaries.id, id));
    return r ? toRow(r) : null;
  }

  async getDek(id: string): Promise<Buffer> {
    const now = this.deps.now().getTime();
    const hit = this.deks.get(id);
    if (hit && hit.expires > now) return hit.dek;
    const [r] = await this.deps.db.select({ w: beneficiaries.wrappedDek }).from(beneficiaries).where(eq(beneficiaries.id, id));
    if (!r) throw new Error(`beneficiary not found: ${id}`);
    if (!r.w) {
      this.deks.delete(id);
      throw new Error(`beneficiary data key destroyed: ${id}`);
    }
    const dek = this.deps.crypto.unwrapDek(r.w);
    this.deks.set(id, { dek, expires: now + DEK_TTL_MS });
    return dek;
  }

  /** Drop a cached DEK (after crypto-shredding). */
  forgetDek(id: string): void {
    this.deks.delete(id);
  }

  async getWaId(id: string): Promise<string> {
    const [r] = await this.deps.db.select({ e: beneficiaries.waIdEnc }).from(beneficiaries).where(eq(beneficiaries.id, id));
    if (!r) throw new Error(`beneficiary not found: ${id}`);
    return this.deps.crypto.decrypt(await this.getDek(id), r.e).toString("utf8");
  }

  async setLanguage(id: string, language: LanguageCode, confirmed: boolean) {
    await this.deps.db.update(beneficiaries).set({ language, languageConfirmed: confirmed }).where(eq(beneficiaries.id, id));
  }

  async setConversationState(id: string, state: ConversationState) {
    await this.deps.db.update(beneficiaries).set({ conversationState: state }).where(eq(beneficiaries.id, id));
  }

  async touchInbound(id: string, at: Date) {
    await this.deps.db.update(beneficiaries).set({ lastInboundAt: at }).where(eq(beneficiaries.id, id));
  }

  async archiveAll(id: string) {
    const { db, config } = this.deps;
    const now = this.deps.now();
    const purgeAt = new Date(now.getTime() + config.ARCHIVE_RETENTION_DAYS * 86_400_000);
    await db.transaction(async (tx) => {
      await tx
        .update(beneficiaries)
        .set({ archivedAt: now, purgeAt, announcementsOptInAt: null, nicknameEnc: null })
        .where(and(eq(beneficiaries.id, id), isNull(beneficiaries.archivedAt)));
      const docs = await tx
        .update(documents)
        .set({ archivedAt: now, purgeAt })
        .where(and(eq(documents.beneficiaryId, id), isNull(documents.archivedAt)))
        .returning({ id: documents.id });
      await cancelRemindersFor(tx, docs.map((d) => d.id));
    });
  }

  async readNickname(id: string, enc: Buffer | null): Promise<string | null> {
    if (!enc) return null;
    try {
      return this.deps.crypto.decrypt(await this.getDek(id), enc).toString("utf8");
    } catch {
      return null; // data key destroyed: the nickname went with the rest
    }
  }

  async setNickname(id: string, nickname: string | null): Promise<string | null> {
    const clean = nickname?.trim() || null;
    const nicknameEnc = clean ? this.deps.crypto.encrypt(await this.getDek(id), clean) : null;
    await this.deps.db.update(beneficiaries).set({ nicknameEnc }).where(eq(beneficiaries.id, id));
    return clean;
  }

  async label(id: string): Promise<string> {
    const [r] = await this.deps.db.select({ l: beneficiaries.waIdLast2 }).from(beneficiaries).where(eq(beneficiaries.id, id));
    return `${LABEL_MASK} ${r?.l ?? "••"}`;
  }
}

export const maskedLabel = (last2: string): string => `${LABEL_MASK} ${last2}`;
