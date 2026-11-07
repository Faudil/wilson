/**
 * Unusual access detection. Every procedure that reveals one person's personal data counts the distinct people a
 * volunteer opened in the last hour; above AUDIT_READS_PER_HOUR an alert goes out (and, with
 * AUDIT_BULK_READ_ACTION=suspend, the account is disabled at once). Polling the same conversation does not count twice.
 */
import { eq } from "drizzle-orm";
import { alert } from "../alerts.js";
import { accessLog, sessions, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";

/** procedure path → how to find the person (or the object) it reveals in the input. */
export const SENSITIVE_READS: Record<string, (input: any) => string | undefined> = {
  "letters.get": (i) => i?.id,
  "letters.photo": (i) => i?.id,
  "beneficiaries.get": (i) => i?.id,
  "documents.file": (i) => i?.id,
  "conversations.get": (i) => i?.beneficiaryId,
  "notes.list": (i) => i?.beneficiaryId,
  "skills.suggest": (i) => i?.beneficiaryId,
};

const HOUR = 3600_000;
interface Window { seen: Map<string, number>; alertedAt: number }
const windows = new WeakMap<object, Map<string, Window>>();

export async function recordRead(deps: Deps, volunteer: { id: string; name: string }, path: string, input: unknown): Promise<void> {
  const target = SENSITIVE_READS[path]?.(input);
  if (!target) return;
  let all = windows.get(deps.config);
  if (!all) windows.set(deps.config, (all = new Map()));
  let w = all.get(volunteer.id);
  if (!w) all.set(volunteer.id, (w = { seen: new Map(), alertedAt: -Infinity }));
  const now = deps.now().getTime();
  for (const [k, at] of w.seen) if (at <= now - HOUR) w.seen.delete(k);
  w.seen.set(target, now);
  if (w.seen.size <= deps.config.AUDIT_READS_PER_HOUR || now - w.alertedAt < HOUR) return;
  w.alertedAt = now;
  const suspend = deps.config.AUDIT_BULK_READ_ACTION === "suspend";
  await deps.db.insert(accessLog).values({ volunteerId: volunteer.id, action: `audit.bulk_read:${w.seen.size}${suspend ? ":suspended" : ""}`, targetId: null });
  if (suspend) {
    await deps.db.update(volunteers).set({ disabledAt: deps.now() }).where(eq(volunteers.id, volunteer.id));
    await deps.db.delete(sessions).where(eq(sessions.volunteerId, volunteer.id));
  }
  void alert(deps, `audit.bulk:${volunteer.id}`,
    `${volunteer.name} opened ${w.seen.size} different files, letters or conversations in one hour (limit ${deps.config.AUDIT_READS_PER_HOUR}).` +
    (suspend ? " The account was disabled; an admin can re-enable it in Bénévoles." : " Check with them; an admin can disable the account in Bénévoles."));
}
