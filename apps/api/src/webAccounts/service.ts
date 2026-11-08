/**
 * Web accounts ("Mon espace"): people who use Wilson from a web page instead of WhatsApp, with no phone number.
 *
 * An account is a beneficiaries row whose address is "web:<id>" (see whatsapp/web.ts), so the conversation engine,
 * letters, documents, reminders and volunteers' screens all work unchanged. What the person chose (a name) is
 * encrypted under their DEK like everything else. They sign in with RECOVERY_WORD_COUNT words from RECOVERY_WORDS,
 * drawn by the server; only HMAC(LOOKUP_KEY, words) is kept, so a database leak alone does not reveal them, and
 * guessing online is limited per IP and for everyone together.
 *
 * Lost words: a volunteer (beneficiaries.recover, 2FA) checks in person who they are and gives a one-time unlock code
 * (24 h). Issuing it cancels the old words and signs the account out everywhere; the code gives new words.
 * Lock: signs out everywhere and refuses the words until an unlock code is used (lost phone, someone knows the words).
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { RECOVERY_WORD_COUNT, RECOVERY_WORDS, type LanguageCode, type Me, type WebAccount } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { alert } from "../alerts.js";
import { Attempts } from "../auth/limiter.js";
import type { Config } from "../config.js";
import type { Crypto } from "../crypto/keys.js";
import type { Db } from "../db/client.js";
import { beneficiaries, beneficiarySessions } from "../db/schema.js";
import type { JobQueue } from "../jobs/names.js";
import { enqueueText } from "../whatsapp/send.js";
import { webAddress } from "../whatsapp/web.js";
import type { BeneficiariesServiceImpl } from "../beneficiaries/serviceImpl.js";
import { getServices, type ServiceDeps } from "../services.js";

const HOUR = 3600_000;
const SHARED_SESSION_MS = HOUR;
const UNLOCK_CODE_MS = 24 * HOUR;
/** No 0/O, 1/I/L: codes and account numbers are read aloud and copied by hand. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
const randomChars = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export type WebConfig = Pick<Config,
  "BENEFICIARY_SIGNUP" | "WEB_SIGNUP_PER_IP_PER_HOUR" | "WEB_SIGNUP_PER_DAY" | "WEB_LOGIN_FAILURES_PER_IP" |
  "WEB_LOGIN_FAILURES_PER_HOUR" | "WEB_SESSION_DAYS" | "ASSOCIATION_NAME" | "ASSOCIATION_CONTACT" | "ALERT_WEBHOOK_URL">;

export interface WebAccountsDeps {
  db: Db;
  crypto: Crypto;
  config: WebConfig;
  now: () => Date;
  jobs: Pick<JobQueue, "send">;
  beneficiaries: BeneficiariesServiceImpl;
}

export interface WebSession {
  token: string;
  expires: Date;
}

export type WebResult<T> =
  | ({ kind: "ok" } & T)
  | { kind: "invalid" }
  | { kind: "locked" }
  | { kind: "closed" }
  | { kind: "rate_limited"; retryAfterSeconds: number };

type Row = typeof beneficiaries.$inferSelect;

export function createWebAccounts(deps: WebAccountsDeps) {
  const { db, crypto, config } = deps;
  const failuresByIp = new Attempts(15 * 60_000);
  const failuresAll = new Attempts(HOUR);
  const signupsByIp = new Attempts(HOUR);
  const signupsAll = new Attempts(24 * HOUR);

  const wordsHash = (words: readonly string[]) => crypto.lookupHash(`web-words:${words.join(" ")}`);
  const unlockHash = (code: string) => crypto.lookupHash(`web-unlock:${code}`);
  /** Six different words (no repeats: easier to read back), ~42 bits. Guessing is online only and rate-limited. */
  const drawWords = () => {
    const picked = new Set<string>();
    while (picked.size < RECOVERY_WORD_COUNT) picked.add(RECOVERY_WORDS[randomInt(RECOVERY_WORDS.length)]![0]);
    return [...picked];
  };

  /** Refused for now? (too many wrong words or codes from this IP, or from everyone). */
  function blocked(ip: string | null, now: number): number {
    const key = ip ? `ip:${ip}` : null;
    if (key && failuresByIp.count(key, now) >= config.WEB_LOGIN_FAILURES_PER_IP) return failuresByIp.retryAfter(key, now);
    if (failuresAll.count("all", now) >= config.WEB_LOGIN_FAILURES_PER_HOUR) return failuresAll.retryAfter("all", now);
    return 0;
  }
  function failed(ip: string | null, now: number): void {
    if (ip) failuresByIp.add(`ip:${ip}`, now);
    if (failuresAll.add("all", now) === config.WEB_LOGIN_FAILURES_PER_HOUR) {
      void alert(deps, "web.login_flood", `${config.WEB_LOGIN_FAILURES_PER_HOUR} wrong recovery words or unlock codes in one hour: web sign-in is refused for everyone for a while. Someone may be guessing.`);
    }
  }

  async function newSession(beneficiaryId: string, sharedDevice: boolean): Promise<WebSession> {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(deps.now().getTime() + (sharedDevice ? SHARED_SESSION_MS : config.WEB_SESSION_DAYS * 24 * HOUR));
    await db.insert(beneficiarySessions).values({ idHash: sha256Hex(token), beneficiaryId, sharedDevice, expiresAt: expires });
    return { token, expires };
  }

  async function nameOf(row: Row): Promise<string> {
    if (!row.webNameEnc || !row.wrappedDek) return "";
    return crypto.decrypt(await deps.beneficiaries.getDek(row.id), row.webNameEnc).toString("utf8");
  }

  async function toMe(row: Row, sharedDevice: boolean): Promise<Me> {
    return {
      name: await nameOf(row), language: row.language, handle: row.webHandle!, sharedDevice,
      associationName: config.ASSOCIATION_NAME, associationContact: config.ASSOCIATION_CONTACT,
    };
  }

  /** New words for an account (sign-up, unlock code). Retries on the (astronomically unlikely) clash with another account. */
  async function setNewWords(id: string): Promise<string[]> {
    for (let i = 0; i < 5; i++) {
      const words = drawWords();
      const done = await db.update(beneficiaries).set({ webWordsHash: wordsHash(words) }).where(eq(beneficiaries.id, id))
        .returning({ id: beneficiaries.id }).catch(() => []);
      if (done.length) return words;
    }
    throw new Error("could not draw unique recovery words");
  }

  async function activeRow(id: string): Promise<Row | null> {
    const [row] = await db.select().from(beneficiaries).where(and(eq(beneficiaries.id, id), isNull(beneficiaries.archivedAt)));
    return row?.webHandle ? row : null;
  }

  return {
    async signup(input: { name: string; language: LanguageCode; sharedDevice: boolean }, ip: string | null): Promise<WebResult<{ session: WebSession; me: Me; words: string[] }>> {
      if (config.BENEFICIARY_SIGNUP !== "on") return { kind: "closed" };
      const now = deps.now().getTime();
      const ipKey = ip ? `ip:${ip}` : null;
      if (ipKey && signupsByIp.count(ipKey, now) >= config.WEB_SIGNUP_PER_IP_PER_HOUR) return { kind: "rate_limited", retryAfterSeconds: signupsByIp.retryAfter(ipKey, now) };
      if (signupsAll.count("all", now) >= config.WEB_SIGNUP_PER_DAY) {
        void alert(deps, "web.signup_flood", `more than ${config.WEB_SIGNUP_PER_DAY} web accounts created in 24 h: new ones are refused for now.`);
        return { kind: "rate_limited", retryAfterSeconds: signupsAll.retryAfter("all", now) };
      }
      if (ipKey) signupsByIp.add(ipKey, now);
      signupsAll.add("all", now);

      const id = randomUUID();
      const address = webAddress(id);
      const { dek, wrapped } = crypto.newDek();
      let handle = "";
      for (let i = 0; i < 5 && !handle; i++) {
        const candidate = `W-${randomChars(6)}`;
        const inserted = await db.insert(beneficiaries).values({
          id, waIdHash: crypto.lookupHash(address), waIdEnc: crypto.encrypt(dek, address), waIdLast2: "", wrappedDek: wrapped,
          language: input.language, languageConfirmed: true, conversationState: { step: "main_menu" },
          webHandle: candidate, webNameEnc: crypto.encrypt(dek, input.name.trim()), createdAt: deps.now(),
        }).onConflictDoNothing().returning({ id: beneficiaries.id });
        if (inserted.length) handle = candidate;
      }
      if (!handle) throw new Error("could not draw a unique account number");
      const words = await setNewWords(id);
      // Their page opens on the same welcome and menu as WhatsApp.
      await enqueueText(deps, id, waText(input.language, "welcome"));
      await enqueueText(deps, id, waText(input.language, "main_menu"), { interactive: true });
      const row = (await activeRow(id))!;
      return { kind: "ok", session: await newSession(id, input.sharedDevice), me: await toMe(row, input.sharedDevice), words };
    },

    async login(words: readonly string[], sharedDevice: boolean, ip: string | null): Promise<WebResult<{ session: WebSession; me: Me }>> {
      const now = deps.now().getTime();
      const wait = blocked(ip, now);
      if (wait > 0) return { kind: "rate_limited", retryAfterSeconds: wait };
      const [row] = await db.select().from(beneficiaries)
        .where(and(eq(beneficiaries.webWordsHash, wordsHash(words)), isNull(beneficiaries.archivedAt)));
      if (!row) {
        failed(ip, now);
        return { kind: "invalid" };
      }
      if (row.webLockedAt) return { kind: "locked" };
      return { kind: "ok", session: await newSession(row.id, sharedDevice), me: await toMe(row, sharedDevice) };
    },

    /** A volunteer's unlock code: new words, lock lifted, signed in. One use. */
    async redeem(code: string, sharedDevice: boolean, ip: string | null): Promise<WebResult<{ session: WebSession; me: Me; words: string[] }>> {
      const now = deps.now().getTime();
      const wait = blocked(ip, now);
      if (wait > 0) return { kind: "rate_limited", retryAfterSeconds: wait };
      // Conditional update: the same code cannot be used twice, even by two requests at once.
      const [used] = await db.update(beneficiaries)
        .set({ webUnlockHash: null, webUnlockUntil: null, webLockedAt: null, webLockedBy: null })
        .where(and(eq(beneficiaries.webUnlockHash, unlockHash(code)), gt(beneficiaries.webUnlockUntil, deps.now()), isNull(beneficiaries.archivedAt)))
        .returning({ id: beneficiaries.id });
      if (!used) {
        failed(ip, now);
        return { kind: "invalid" };
      }
      const words = await setNewWords(used.id);
      const row = (await activeRow(used.id))!;
      return { kind: "ok", session: await newSession(used.id, sharedDevice), me: await toMe(row, sharedDevice), words };
    },

    /** The account behind a session cookie, or null (unknown, expired, locked, deleted). */
    async resolve(token: string): Promise<{ beneficiaryId: string; sharedDevice: boolean } | null> {
      const [s] = await db.select().from(beneficiarySessions).where(eq(beneficiarySessions.idHash, sha256Hex(token))).limit(1);
      if (!s || s.expiresAt <= deps.now()) return null;
      const row = await activeRow(s.beneficiaryId);
      if (!row || row.webLockedAt) return null;
      return { beneficiaryId: s.beneficiaryId, sharedDevice: s.sharedDevice };
    },

    async me(beneficiaryId: string, sharedDevice: boolean): Promise<Me | null> {
      const row = await activeRow(beneficiaryId);
      return row ? toMe(row, sharedDevice) : null;
    },

    async logout(token: string): Promise<void> {
      await db.delete(beneficiarySessions).where(eq(beneficiarySessions.idHash, sha256Hex(token)));
    },

    async signOutEverywhere(beneficiaryId: string): Promise<void> {
      await db.delete(beneficiarySessions).where(eq(beneficiarySessions.beneficiaryId, beneficiaryId));
    },

    // ---------------------------------------------------------------- volunteers

    /** What the back-office shows; the name only when `withName` (the person page). Null for WhatsApp people. */
    async describe(row: Row, withName: boolean): Promise<WebAccount | null> {
      if (!row.webHandle) return null;
      return {
        handle: row.webHandle,
        name: withName ? await nameOf(row) : null,
        lockedAt: row.webLockedAt?.toISOString() ?? null,
        unlockCodeUntil: row.webUnlockUntil && row.webUnlockUntil > deps.now() ? row.webUnlockUntil.toISOString() : null,
      };
    },

    /** One-time code for someone who lost their words. The old words stop working now. Null if not a web account. */
    async issueUnlockCode(beneficiaryId: string): Promise<{ code: string; expiresAt: Date } | null> {
      const raw = randomChars(8);
      const expiresAt = new Date(deps.now().getTime() + UNLOCK_CODE_MS);
      const done = await db.update(beneficiaries).set({ webUnlockHash: unlockHash(raw), webUnlockUntil: expiresAt, webWordsHash: null })
        .where(and(eq(beneficiaries.id, beneficiaryId), isNull(beneficiaries.archivedAt), isNotNull(beneficiaries.webHandle)))
        .returning({ id: beneficiaries.id });
      if (!done.length) return null;
      await this.signOutEverywhere(beneficiaryId);
      return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
    },

    async setLocked(beneficiaryId: string, locked: boolean, volunteerId: string): Promise<boolean> {
      const done = await db.update(beneficiaries)
        .set(locked ? { webLockedAt: deps.now(), webLockedBy: volunteerId } : { webLockedAt: null, webLockedBy: null })
        .where(and(eq(beneficiaries.id, beneficiaryId), isNull(beneficiaries.archivedAt), isNotNull(beneficiaries.webHandle)))
        .returning({ id: beneficiaries.id });
      if (!done.length) return false;
      if (locked) await this.signOutEverywhere(beneficiaryId);
      return true;
    },
  };
}

export type WebAccounts = ReturnType<typeof createWebAccounts>;

const cache = new WeakMap<object, WebAccounts>();
/** One instance per deps object (the rate-limit counters live in it). */
export function getWebAccounts(deps: ServiceDeps): WebAccounts {
  let w = cache.get(deps);
  if (!w) cache.set(deps, (w = createWebAccounts({ ...deps, beneficiaries: getServices(deps).beneficiaries })));
  return w;
}
