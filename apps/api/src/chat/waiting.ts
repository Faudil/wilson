import { and, count, eq, isNull, lt } from "drizzle-orm";
import { alert } from "../alerts.js";
import { beneficiaries, letters } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { localTime } from "../time.js";
import { getChat } from "./service.js";

/** Only during the day: nobody should be paged at night for a chat message. */
const FIRST_HOUR = 8;
const LAST_HOUR = 21;
const lastSent = new WeakMap<object, number>();

/**
 * Hourly: when people have been waiting more than WAITING_ALERT_HOURS for a volunteer (a conversation that needs a
 * person, or a letter waiting for review), post the counts to the alert channel. Never who, never what they wrote.
 * Repeated at most every WAITING_ALERT_HOURS while people keep waiting.
 */
export async function dispatchWaitingAlert(deps: Deps, now: Date): Promise<{ people: number; letters: number; sent: boolean }> {
  const hours = deps.config.WAITING_ALERT_HOURS;
  const none = { people: 0, letters: 0, sent: false };
  if (!hours) return none;
  const hour = Number(localTime(now, deps.config.TIMEZONE).slice(0, 2));
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return none;

  const before = new Date(now.getTime() - hours * 3600_000);
  const people = await getChat(deps).waitingCount(before);
  const [row] = await deps.db.select({ n: count() }).from(letters)
    .innerJoin(beneficiaries, eq(beneficiaries.id, letters.beneficiaryId))
    .where(and(eq(letters.status, "pending_review"), lt(letters.receivedAt, before), isNull(beneficiaries.archivedAt)));
  const pendingLetters = row?.n ?? 0;
  if (people + pendingLetters === 0) return { people, letters: pendingLetters, sent: false };

  const prev = lastSent.get(deps.config);
  if (prev !== undefined && now.getTime() - prev < hours * 3600_000) return { people, letters: pendingLetters, sent: false };
  lastSent.set(deps.config, now.getTime());

  const parts = [
    people ? `${people} ${people > 1 ? "personnes attendent" : "personne attend"} une réponse` : null,
    pendingLetters ? `${pendingLetters} ${pendingLetters > 1 ? "lettres attendent" : "lettre attend"} une relecture` : null,
  ].filter(Boolean);
  await alert(deps, "waiting", `${parts.join(" et ")} depuis plus de ${hours} h. Ouvrez Wilson → À traiter.`);
  return { people, letters: pendingLetters, sent: true };
}
