/**
 * Flood guard for inbound WhatsApp messages. Protects the Claude budget and the volunteers' queues from people
 * (or groups) who flood the number.
 *
 *   per number   above WA_RATE_*   → throttle: the message is stored but not processed (no LLM), and the person is
 *                                    asked once every 10 minutes to slow down.
 *                above WA_FLOOD_*  → quarantine: nothing from this number is processed or stored any more, until a
 *                                    volunteer releases or blocks it (Plus → Numéros en attente).
 *   all numbers  above WA_GLOBAL_* → flood mode: the first messages of numbers first seen in the last 24 h are
 *                                    quarantined; people we already know keep being served.
 *
 * Counters live in memory (one API process, see ARCHITECTURE §3): no database work per message, and a restart only
 * forgets the last minutes. Blocked and quarantined numbers are dropped before any database write.
 */
import { and, eq } from "drizzle-orm";
import type { LanguageCode } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { alert } from "../alerts.js";
import type { BeneficiaryRow } from "../beneficiaries/service.js";
import type { Config } from "../config.js";
import { beneficiaries } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { enqueueText } from "./send.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOTICE_EVERY_MS = 10 * MINUTE;

export type GuardVerdict =
  | { kind: "ok" }
  | { kind: "throttle"; notify: boolean }
  | { kind: "quarantine"; reason: "flood" | "global_flood" };

type Limits = Pick<Config,
  "WA_RATE_PER_MINUTE" | "WA_RATE_PER_HOUR" | "WA_FILES_PER_DAY" | "WA_FLOOD_PER_MINUTE" | "WA_FLOOD_PER_HOUR" |
  "WA_FLOOD_PER_DAY" | "WA_GLOBAL_PER_MINUTE" | "WA_GLOBAL_PER_HOUR">;

interface NumberWindow {
  /** Inbound message times (ms), oldest first, last 24 h, capped. */
  all: number[];
  files: number[];
  noticeAt: number;
}

/** Fixed-size ring of counters: `slots` buckets of `width` ms. Constant memory whatever the traffic. */
class Ring {
  private readonly counts: number[];
  private readonly stamps: number[];
  constructor(private readonly slots: number, private readonly width: number) {
    this.counts = new Array(slots).fill(0);
    this.stamps = new Array(slots).fill(-1);
  }
  add(now: number): void {
    const b = Math.floor(now / this.width);
    const i = b % this.slots;
    if (this.stamps[i] !== b) {
      this.stamps[i] = b;
      this.counts[i] = 0;
    }
    this.counts[i]!++;
  }
  sum(now: number): number {
    const b = Math.floor(now / this.width);
    let n = 0;
    for (let i = 0; i < this.slots; i++) if (this.stamps[i]! > b - this.slots) n += this.counts[i]!;
    return n;
  }
}

export class FloodGuard {
  private readonly numbers = new Map<string, NumberWindow>();
  private readonly globalMinute = new Ring(60, 1000);
  private readonly globalHour = new Ring(60, MINUTE);
  private lastPrune = 0;

  constructor(private readonly limits: Limits) {}

  /** Count one (non-duplicate) inbound message and decide what to do with it. */
  check(b: Pick<BeneficiaryRow, "id" | "createdAt">, isFile: boolean, at: Date): GuardVerdict {
    const now = at.getTime();
    const L = this.limits;
    this.prune(now);
    this.globalMinute.add(now);
    this.globalHour.add(now);

    let w = this.numbers.get(b.id);
    if (!w) this.numbers.set(b.id, (w = { all: [], files: [], noticeAt: -Infinity }));
    push(w.all, now, L.WA_FLOOD_PER_DAY + 1);
    if (isFile) push(w.files, now, L.WA_FILES_PER_DAY + 1);
    const minute = countSince(w.all, now - MINUTE);
    const hour = countSince(w.all, now - HOUR);
    const day = countSince(w.all, now - DAY);

    if (minute > L.WA_FLOOD_PER_MINUTE || hour > L.WA_FLOOD_PER_HOUR || day > L.WA_FLOOD_PER_DAY) return { kind: "quarantine", reason: "flood" };
    if (this.floodMode(at) && now - b.createdAt.getTime() < DAY) return { kind: "quarantine", reason: "global_flood" };

    const tooFast = minute > L.WA_RATE_PER_MINUTE || hour > L.WA_RATE_PER_HOUR;
    const tooManyFiles = isFile && countSince(w.files, now - DAY) > L.WA_FILES_PER_DAY;
    if (tooFast || tooManyFiles) {
      const notify = now - w.noticeAt >= NOTICE_EVERY_MS;
      if (notify) w.noticeAt = now;
      return { kind: "throttle", notify };
    }
    return { kind: "ok" };
  }

  floodMode(at: Date): boolean {
    const now = at.getTime();
    return this.globalMinute.sum(now) > this.limits.WA_GLOBAL_PER_MINUTE || this.globalHour.sum(now) > this.limits.WA_GLOBAL_PER_HOUR;
  }

  /** A volunteer released the number: start counting from zero. */
  forget(beneficiaryId: string): void {
    this.numbers.delete(beneficiaryId);
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 10 * MINUTE) return;
    this.lastPrune = now;
    for (const [id, w] of this.numbers) if ((w.all.at(-1) ?? 0) < now - DAY) this.numbers.delete(id);
  }
}

function push(list: number[], now: number, cap: number): void {
  list.push(now);
  if (list.length > cap) list.splice(0, list.length - cap);
}
function countSince(list: number[], since: number): number {
  let n = 0;
  for (let i = list.length - 1; i >= 0 && list[i]! > since; i--) n++;
  return n;
}

// One guard per running app (keyed on the shared config object: the same for Deps and WaDeps).
const guards = new WeakMap<object, FloodGuard>();
export function getGuard(deps: Pick<Deps, "config">): FloodGuard {
  let g = guards.get(deps.config);
  if (!g) guards.set(deps.config, (g = new FloodGuard(deps.config)));
  return g;
}

/** Text for a person whose language we do not know yet: French, English and Arabic. */
function noticeText(lang: LanguageCode, confirmed: boolean, key: "guard_slow_down" | "guard_held" | "guard_released"): string {
  if (confirmed) return waText(lang, key);
  return (["fr", "en", "ar"] as const).map((l) => waText(l, key)).join("\n\n");
}

/** Put a number in quarantine (guard decision or volunteer), tell the person once, and alert. */
export async function quarantine(deps: Deps, b: BeneficiaryRow, reason: "flood" | "global_flood"): Promise<void> {
  const changed = await deps.db.update(beneficiaries)
    .set({ guardStatus: "quarantined", guardReason: reason, guardAt: deps.now(), guardBy: null })
    .where(and(eq(beneficiaries.id, b.id), eq(beneficiaries.guardStatus, "none")))
    .returning({ id: beneficiaries.id });
  if (!changed.length) return;
  await enqueueText(deps, b.id, noticeText(b.language, b.languageConfirmed, "guard_held"));
  void alert(deps, `guard.${reason}`, reason === "flood"
    ? "a WhatsApp number sent too many messages and was put on hold. A volunteer should check Plus → Numéros en attente."
    : "flood mode: a wave of messages is coming in. First messages from new numbers are put on hold for volunteer review.");
}

export async function throttleNotice(deps: Deps, b: BeneficiaryRow): Promise<void> {
  await enqueueText(deps, b.id, noticeText(b.language, b.languageConfirmed, "guard_slow_down"));
}

export async function releasedNotice(deps: Deps, b: BeneficiaryRow): Promise<void> {
  await enqueueText(deps, b.id, noticeText(b.language, b.languageConfirmed, "guard_released"));
}
