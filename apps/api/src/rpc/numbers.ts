import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { HeldNumber } from "@wilson/contracts";
import { maskedLabel } from "../beneficiaries/serviceImpl.js";
import { beneficiaries, messages } from "../db/schema.js";
import { getGuard, releasedNotice } from "../whatsapp/guard.js";
import { getWaDeps } from "../whatsapp/context.js";
import { logAccess } from "./logAccess.js";
import { os, requirePermission } from "./base.js";

const moderate = requirePermission("numbers.moderate");
const DAY = 24 * 3600_000;
const PREVIEW_CHARS = 280;

async function mustRow(id: string) {
  const [r] = await getWaDeps().db.select().from(beneficiaries).where(eq(beneficiaries.id, id)).limit(1);
  if (!r || r.archivedAt) throw new ORPCError("NOT_FOUND");
  return r;
}

async function release(id: string, volunteerId: string, notify: boolean): Promise<boolean> {
  const deps = getWaDeps();
  const changed = await deps.db.update(beneficiaries)
    .set({ guardStatus: "none", guardReason: null, guardAt: deps.now(), guardBy: volunteerId })
    .where(and(eq(beneficiaries.id, id), eq(beneficiaries.guardStatus, "quarantined")))
    .returning({ id: beneficiaries.id });
  if (!changed.length) return false;
  getGuard(deps).forget(id);
  if (notify) {
    const b = await deps.beneficiaries.get(id);
    if (b) await releasedNotice(deps, b);
  }
  return true;
}

export const numbersRouter = {
  list: os.numbers.list.use(moderate).handler(async ({ input, context }) => {
    const deps = getWaDeps();
    const rows = await deps.db.select().from(beneficiaries)
      .where(and(eq(beneficiaries.guardStatus, input.status), sql`${beneficiaries.archivedAt} is null`))
      .orderBy(desc(beneficiaries.guardAt)).limit(200);
    const ids = rows.map((r) => r.id);
    const counts = new Map<string, number>();
    const lastText = new Map<string, Buffer | null>();
    if (ids.length) {
      for (const c of await deps.db.select({ id: messages.beneficiaryId, n: sql<number>`count(*)::int` }).from(messages)
        .where(and(inArray(messages.beneficiaryId, ids), eq(messages.direction, "in"))).groupBy(messages.beneficiaryId)) counts.set(c.id, c.n);
      for (const m of await deps.db.selectDistinctOn([messages.beneficiaryId], { id: messages.beneficiaryId, body: messages.bodyEnc }).from(messages)
        .where(and(inArray(messages.beneficiaryId, ids), eq(messages.direction, "in"), sql`${messages.bodyEnc} is not null`))
        .orderBy(messages.beneficiaryId, desc(messages.createdAt))) lastText.set(m.id, m.body);
    }
    const items: HeldNumber[] = [];
    for (const r of rows) {
      const enc = lastText.get(r.id);
      let text: string | null = null;
      if (enc) {
        try {
          text = deps.crypto.decrypt(await deps.beneficiaries.getDek(r.id), enc).toString("utf8").slice(0, PREVIEW_CHARS);
        } catch { text = null; }
      }
      const since = r.guardAt ?? r.createdAt;
      items.push({
        beneficiaryId: r.id, label: maskedLabel(r.waIdLast2, r.webHandle, r.avatar), language: r.language,
        status: r.guardStatus as HeldNumber["status"], reason: (r.guardReason ?? "manual") as HeldNumber["reason"],
        since: since.toISOString(), totalMessages: counts.get(r.id) ?? 0, lastText: text,
        knownBefore: since.getTime() - r.createdAt.getTime() > DAY,
      });
    }
    await logAccess(context, `numbers.list:${input.status}`, null);
    return { items, floodMode: getGuard(deps).floodMode(deps.now()) };
  }),

  heldCount: os.numbers.heldCount.use(moderate).handler(async () => {
    const deps = getWaDeps();
    const [r] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(beneficiaries)
      .where(and(eq(beneficiaries.guardStatus, "quarantined"), sql`${beneficiaries.archivedAt} is null`));
    return { count: r?.n ?? 0, floodMode: getGuard(deps).floodMode(deps.now()) };
  }),

  release: os.numbers.release.use(moderate).handler(async ({ input, context }) => {
    const r = await mustRow(input.beneficiaryId);
    if (r.guardStatus !== "quarantined") throw new ORPCError("CONFLICT", { data: { reason: "not_held" } });
    await release(r.id, context.volunteer.id, true);
    await logAccess(context, "numbers.release", r.id);
  }),

  releaseAllGlobal: os.numbers.releaseAllGlobal.use(moderate).handler(async ({ context }) => {
    const deps = getWaDeps();
    const held = await deps.db.select({ id: beneficiaries.id }).from(beneficiaries)
      .where(and(eq(beneficiaries.guardStatus, "quarantined"), eq(beneficiaries.guardReason, "global_flood")));
    let released = 0;
    for (const h of held) if (await release(h.id, context.volunteer.id, true)) released++;
    await logAccess(context, `numbers.release_all:${released}`, null);
    return { released };
  }),

  block: os.numbers.block.use(moderate).handler(async ({ input, context }) => {
    const deps = getWaDeps();
    const r = await mustRow(input.beneficiaryId);
    if (r.guardStatus === "blocked") return;
    await deps.db.update(beneficiaries)
      .set({ guardStatus: "blocked", guardReason: r.guardReason ?? "manual", guardAt: deps.now(), guardBy: context.volunteer.id, chatAssigneeId: null, chatStatus: "resolved" })
      .where(eq(beneficiaries.id, r.id));
    getGuard(deps).forget(r.id);
    await logAccess(context, "numbers.block", r.id);
  }),

  unblock: os.numbers.unblock.use(moderate).handler(async ({ input, context }) => {
    const deps = getWaDeps();
    const r = await mustRow(input.beneficiaryId);
    if (r.guardStatus !== "blocked") throw new ORPCError("CONFLICT", { data: { reason: "not_blocked" } });
    await deps.db.update(beneficiaries).set({ guardStatus: "none", guardReason: null, guardAt: deps.now(), guardBy: context.volunteer.id }).where(eq(beneficiaries.id, r.id));
    await logAccess(context, "numbers.unblock", r.id);
  }),
};
