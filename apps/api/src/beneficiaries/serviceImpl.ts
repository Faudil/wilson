import { eq, and, isNull, sql } from "drizzle-orm";
import { isBsuid, type LanguageCode } from "@wilson/contracts";
import type { ChannelId } from "../channels/types.js";
import type { Deps } from "../deps.js";
import { beneficiaries, documents, type ConversationState } from "../db/schema.js";
import { cancelRemindersFor } from "../documents/reminders.js";
import type { BeneficiariesService, BeneficiaryRow } from "./service.js";

const DEK_TTL_MS = 5 * 60_000;
const LABEL_MASK = "•• •• •• ••";
/** Last 2 digits for the masked label; a BSUID (or a channel id that is not a phone number) has none to show. */
const last2 = (address: string): string => (isBsuid(address) ? "••" : address.replace(/\D/g, "").slice(-2));

type Row = typeof beneficiaries.$inferSelect;
const toRow = (r: Row): BeneficiaryRow => ({
  id: r.id,
  channel: r.channel,
  language: r.language,
  languageConfirmed: r.languageConfirmed,
  conversationState: r.conversationState,
  lastInboundAt: r.lastInboundAt,
  archivedAt: r.archivedAt,
  announcementsOptInAt: r.announcementsOptInAt,
  createdAt: r.createdAt,
  guardStatus: r.guardStatus as BeneficiaryRow["guardStatus"],
  web: r.webHandle !== null,
});

export class BeneficiariesServiceImpl implements BeneficiariesService {
  private readonly deks = new Map<string, { dek: Buffer; expires: number }>();

  constructor(private readonly deps: Pick<Deps, "db" | "crypto" | "config" | "now">) {}

  /**
   * Lookup hash of an address: WhatsApp keeps the bare wa_id (existing rows), web addresses already carry their
   * "web:" prefix (webAccounts/service.ts), other channels are namespaced.
   */
  private hashOf(channel: ChannelId, address: string): string {
    return this.deps.crypto.lookupHash(channel === "whatsapp" || channel === "web" ? address : `${channel}:${address}`);
  }

  findOrCreateByWaId(waId: string, userId?: string) {
    return this.findOrCreate("whatsapp", waId, userId);
  }

  async findOrCreate(channel: ChannelId, address: string, userId?: string) {
    const { db, crypto } = this.deps;
    const hash = this.hashOf(channel, address);
    const userHash = userId ? this.hashOf(channel, userId) : channel === "whatsapp" && isBsuid(address) ? hash : null;
    let [existing] = await db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, hash));
    if (!existing && userHash) {
      // Same person, other address: first seen without their number (BSUID only), or the number is hidden now.
      [existing] = await db.select().from(beneficiaries).where(and(eq(beneficiaries.userIdHash, userHash), eq(beneficiaries.channel, channel)))
        .orderBy(sql`${beneficiaries.archivedAt} asc nulls first`).limit(1);
      if (existing && !existing.archivedAt && !isBsuid(address)) {
        // The phone number is now visible: keep it, it works for every message type (BSUIDs do not, e.g. some templates).
        await this.setAddress(existing.id, channel, address);
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
        channel, waIdHash: hash, waIdEnc: crypto.encrypt(dek, address), waIdLast2: last2(address), userIdHash: userHash, wrappedDek: wrapped,
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

  async changeIdentity(channel: ChannelId, from: { address?: string; userId?: string }, to: { address?: string; userId?: string }): Promise<boolean> {
    const { db, crypto } = this.deps;
    const live = and(isNull(beneficiaries.archivedAt), eq(beneficiaries.channel, channel));
    const find = async (col: typeof beneficiaries.waIdHash | typeof beneficiaries.userIdHash, id?: string) =>
      id ? (await db.select().from(beneficiaries).where(and(eq(col, this.hashOf(channel, id)), live)).limit(1))[0] : undefined;
    const row = (await find(beneficiaries.waIdHash, from.address)) ?? (await find(beneficiaries.userIdHash, from.userId))
      ?? (await find(beneficiaries.waIdHash, from.userId));
    if (!row) return false;
    if (to.address) {
      const taken = await find(beneficiaries.waIdHash, to.address);
      if (taken && taken.id !== row.id) return false; // never merge two people
      await this.setAddress(row.id, channel, to.address);
    } else if (to.userId && isBsuid(crypto.decrypt(await this.getDek(row.id), row.waIdEnc).toString("utf8"))) {
      await this.setAddress(row.id, channel, to.userId); // we only knew the old BSUID: it no longer reaches them
    }
    if (to.userId) await db.update(beneficiaries).set({ userIdHash: this.hashOf(channel, to.userId) }).where(eq(beneficiaries.id, row.id));
    return true;
  }

  private async setAddress(id: string, channel: ChannelId, address: string): Promise<void> {
    const { db, crypto } = this.deps;
    const dek = await this.getDek(id);
    await db.update(beneficiaries)
      .set({ waIdHash: this.hashOf(channel, address), waIdEnc: crypto.encrypt(dek, address), waIdLast2: last2(address) })
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
    return (await this.getAddress(id)).address;
  }

  async getAddress(id: string): Promise<{ channel: ChannelId; address: string }> {
    const [r] = await this.deps.db.select({ e: beneficiaries.waIdEnc, channel: beneficiaries.channel }).from(beneficiaries).where(eq(beneficiaries.id, id));
    if (!r) throw new Error(`beneficiary not found: ${id}`);
    return { channel: r.channel, address: this.deps.crypto.decrypt(await this.getDek(id), r.e).toString("utf8") };
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
        .set({ archivedAt: now, purgeAt, announcementsOptInAt: null })
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
    const [r] = await this.deps.db.select({ l: beneficiaries.waIdLast2, h: beneficiaries.webHandle }).from(beneficiaries).where(eq(beneficiaries.id, id));
    return r ? maskedLabel(r.l, r.h) : `${LABEL_MASK} ••`;
  }
}

/** What volunteers see instead of a phone number: the last 2 digits, or a web account's number. */
export const maskedLabel = (last2: string, webHandle: string | null = null): string => webHandle ?? `${LABEL_MASK} ${last2}`;
