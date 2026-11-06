import { eq, and, isNull } from "drizzle-orm";
import type { LanguageCode } from "@wilson/contracts";
import type { Deps } from "../deps.js";
import { beneficiaries, documents, type ConversationState } from "../db/schema.js";
import { cancelRemindersFor } from "../documents/reminders.js";
import type { BeneficiariesService, BeneficiaryRow } from "./service.js";

const DEK_TTL_MS = 5 * 60_000;
const LABEL_MASK = "•• •• •• ••";

type Row = typeof beneficiaries.$inferSelect;
const toRow = (r: Row): BeneficiaryRow => ({
  id: r.id,
  language: r.language,
  languageConfirmed: r.languageConfirmed,
  conversationState: r.conversationState,
  lastInboundAt: r.lastInboundAt,
  archivedAt: r.archivedAt,
});

export class BeneficiariesServiceImpl implements BeneficiariesService {
  private readonly deks = new Map<string, { dek: Buffer; expires: number }>();

  constructor(private readonly deps: Pick<Deps, "db" | "crypto" | "config" | "now">) {}

  async findOrCreateByWaId(waId: string) {
    const { db, crypto } = this.deps;
    const hash = crypto.lookupHash(waId);
    const [existing] = await db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, hash));
    if (existing) return { beneficiary: toRow(existing), created: false };

    const { dek, wrapped } = crypto.newDek();
    const inserted = await db
      .insert(beneficiaries)
      .values({ waIdHash: hash, waIdEnc: crypto.encrypt(dek, waId), waIdLast2: waId.replace(/\D/g, "").slice(-2), wrappedDek: wrapped })
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
        .set({ archivedAt: now, purgeAt })
        .where(and(eq(beneficiaries.id, id), isNull(beneficiaries.archivedAt)));
      const docs = await tx
        .update(documents)
        .set({ archivedAt: now, purgeAt })
        .where(and(eq(documents.beneficiaryId, id), isNull(documents.archivedAt)))
        .returning({ id: documents.id });
      await cancelRemindersFor(tx, docs.map((d) => d.id));
    });
  }

  async label(id: string): Promise<string> {
    const [r] = await this.deps.db.select({ l: beneficiaries.waIdLast2 }).from(beneficiaries).where(eq(beneficiaries.id, id));
    return `${LABEL_MASK} ${r?.l ?? "••"}`;
  }
}

export const maskedLabel = (last2: string): string => `${LABEL_MASK} ${last2}`;
