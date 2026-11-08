import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { TeamWeek } from "@wilson/contracts";
import { letters, messages, volunteers } from "../db/schema.js";
import { os, requireLogin } from "./base.js";

const WEEK_MS = 7 * 24 * 3600_000;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The team's last 7 days, for the thank-you on the home page: counts only, no beneficiary data, and volunteers by
 * first name (they already see each other's names on conversations and tasks).
 */
export const teamRouter = {
  week: os.team.week.use(requireLogin).handler(async ({ context }): Promise<TeamWeek> => {
    const { deps } = context;
    const me = context.volunteer!.id;
    const since = new Date(deps.now().getTime() - WEEK_MS);
    const sent = await deps.db.select({ b: letters.beneficiaryId, v: letters.reviewedBy }).from(letters)
      .where(and(isNotNull(letters.sentAt), gte(letters.sentAt, since)));
    // Replies a volunteer wrote or approved (bot drafts carry the approving volunteer once sent).
    const replies = await deps.db.select({ b: messages.beneficiaryId, v: messages.volunteerId }).from(messages)
      .where(and(eq(messages.direction, "out"), isNotNull(messages.volunteerId), gte(messages.createdAt, since),
        sql`${messages.chatState} is distinct from 'draft' and ${messages.chatState} is distinct from 'rejected'`));
    const per = new Map<string, number>();
    for (const r of [...sent, ...replies]) if (r.v) per.set(r.v, (per.get(r.v) ?? 0) + 1);
    const others = [...per.entries()].filter(([id]) => id !== me).sort((a, z) => z[1] - a[1]).slice(0, 5).map(([id]) => id);
    const names = others.length
      ? new Map((await deps.db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, others))).map((v) => [v.id, v.name]))
      : new Map<string, string>();
    return {
      lettersExplained: sent.length,
      repliesSent: replies.length,
      peopleHelped: new Set([...sent, ...replies].map((r) => r.b)).size,
      helpers: others.flatMap((id) => (names.has(id) ? [firstName(names.get(id)!)] : [])),
      mine: per.get(me) ?? 0,
    };
  }),
};
