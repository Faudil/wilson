import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, min, sql } from "drizzle-orm";
import type { LetterSummary } from "@wilson/contracts";
import { beneficiaries as bTable, documents as dTable, letters as lTable } from "../db/schema.js";
import { maskedLabel } from "../beneficiaries/serviceImpl.js";
import { getServices } from "../services.js";
import { os, requirePermission } from "./base.js";
import { logAccess } from "./logAccess.js";
import type { Deps } from "../deps.js";

type BRow = typeof bTable.$inferSelect;

async function summaries(deps: Deps, rows: BRow[]) {
  if (rows.length === 0) return [];
  const stats = await deps.db
    .select({ id: dTable.beneficiaryId, n: count(), next: min(dTable.expiresAt) })
    .from(dTable)
    .where(and(inArray(dTable.beneficiaryId, rows.map((r) => r.id)), isNull(dTable.archivedAt), eq(dTable.confirmed, true)))
    .groupBy(dTable.beneficiaryId);
  const byId = new Map(stats.map((s) => [s.id, s]));
  const ben = getServices(deps).beneficiaries;
  const nicknames = await Promise.all(rows.map((r) => ben.readNickname(r.id, r.nicknameEnc)));
  return rows.map((r, i) => ({
    id: r.id,
    label: maskedLabel(r.waIdLast2),
    language: r.language,
    createdAt: r.createdAt.toISOString(),
    lastMessageAt: r.lastInboundAt?.toISOString() ?? null,
    documentCount: byId.get(r.id)?.n ?? 0,
    nextExpiry: byId.get(r.id)?.next ?? null,
    nickname: nicknames[i] ?? null,
  }));
}

const encodeCursor = (r: BRow) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function decodeCursor(c: string): { at: Date; id: string } | null {
  const [at, id] = Buffer.from(c, "base64url").toString().split("|");
  if (!at || !id || Number.isNaN(Date.parse(at))) return null;
  return { at: new Date(at), id };
}

export const beneficiariesRouter = {
  list: os.beneficiaries.list.use(requirePermission("beneficiaries.view")).handler(async ({ input, context }) => {
    const { deps } = context;
    const conds = [isNull(bTable.archivedAt)];
    // Only the last 2 digits are stored: search matches on those.
    const digits = input.search?.replace(/\D/g, "");
    if (digits) conds.push(eq(bTable.waIdLast2, digits.slice(-2)));
    const cur = input.cursor ? decodeCursor(input.cursor) : null;
    // Postgres keeps microseconds but a JS Date only milliseconds: compare against the cursor row's exact timestamp,
    // otherwise rows created in the same millisecond can be skipped.
    if (cur) conds.push(sql`(${bTable.createdAt}, ${bTable.id}) < (select ${bTable.createdAt}, ${bTable.id} from ${bTable} where ${bTable.id} = ${cur.id})`);
    const rows = await deps.db
      .select()
      .from(bTable)
      .where(and(...conds))
      .orderBy(desc(bTable.createdAt), desc(bTable.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return { items: await summaries(deps, page), nextCursor: rows.length > input.limit ? encodeCursor(page[page.length - 1]!) : null };
  }),

  get: os.beneficiaries.get.use(requirePermission("beneficiaries.view")).handler(async ({ input, context }) => {
    const { deps } = context;
    const [row] = await deps.db.select().from(bTable).where(eq(bTable.id, input.id));
    if (!row) throw new ORPCError("NOT_FOUND");
    const [summary] = await summaries(deps, [row]);
    const docs = await getServices(deps).documents.listAllForBeneficiary(row.id);
    const ls = await deps.db.select().from(lTable).where(eq(lTable.beneficiaryId, row.id)).orderBy(desc(lTable.receivedAt));
    const label = maskedLabel(row.waIdLast2);
    const letters: LetterSummary[] = ls.map((l) => ({
      id: l.id,
      beneficiaryId: l.beneficiaryId,
      beneficiaryLabel: label,
      language: row.language,
      status: l.status as LetterSummary["status"],
      letterType: l.letterType as LetterSummary["letterType"],
      urgency: l.urgency as LetterSummary["urgency"],
      deadline: l.deadline,
      lowConfidence: l.lowConfidence,
      receivedAt: l.receivedAt.toISOString(),
    }));
    return { ...summary!, documents: docs, letters };
  }),

  setNickname: os.beneficiaries.setNickname.use(requirePermission("conversations.reply")).handler(async ({ input, context }) => {
    const { deps } = context;
    const [row] = await deps.db.select({ id: bTable.id, archivedAt: bTable.archivedAt }).from(bTable).where(eq(bTable.id, input.id));
    if (!row || row.archivedAt) throw new ORPCError("NOT_FOUND");
    const nickname = await getServices(deps).beneficiaries.setNickname(input.id, input.nickname);
    await logAccess(context, "beneficiaries.set_nickname", input.id);
    return { nickname };
  }),

  setLanguage: os.beneficiaries.setLanguage.use(requirePermission("beneficiaries.edit")).handler(async ({ input, context }) => {
    const { deps } = context;
    const [row] = await deps.db.select().from(bTable).where(eq(bTable.id, input.id));
    if (!row) throw new ORPCError("NOT_FOUND");
    await getServices(deps).beneficiaries.setLanguage(input.id, input.language, true);
    const [updated] = await deps.db.select().from(bTable).where(eq(bTable.id, input.id));
    return (await summaries(deps, [updated!]))[0]!;
  }),
};
