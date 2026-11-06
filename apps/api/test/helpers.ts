import { randomBytes, randomUUID } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import type { ContractRouterClient } from "@orpc/contract";
import pg from "pg";
import { contract, type DocumentAnalysis, type LanguageCode } from "@wilson/contracts";
import { hashPassword } from "../src/auth/service.js";
import { loadConfig, type Config } from "../src/config.js";
import { createCrypto } from "../src/crypto/keysImpl.js";
import { createDb } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { volunteers } from "../src/db/schema.js";
import type { Deps } from "../src/deps.js";
import { InlineQueue } from "../src/jobs/queue.js";
import type { LlmProvider } from "../src/llm/provider.js";
import type { RpcContext } from "../src/rpc/base.js";
import { createContext } from "../src/rpc/context.js";
import { router } from "../src/rpc/router.js";
import { getServices, type Services } from "../src/services.js";
import { MemoryBlobStore } from "../src/storage/memory.js";
import type { WhatsAppTransport } from "../src/whatsapp/transport.js";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://wilson:wilson@localhost:5432/postgres";
const FALLBACK_URL = process.env.TEST_DATABASE_URL ?? "postgres://wilson:wilson@localhost:5432/wilson_test";

/** Mutable fixed clock. */
export class TestClock {
  constructor(public current: Date) {}
  now = (): Date => new Date(this.current);
  set(iso: string): void {
    this.current = new Date(iso);
  }
}

/** LlmProvider stub: `nextDocument` is what analyzeDocument returns; other methods are minimal. */
export class StubLlm implements LlmProvider {
  readonly name = "stub";
  nextDocument: DocumentAnalysis = { promptVersion: "stub@1", type: "recepisse", expiresAt: "2027-03-14", expirySourceQuote: "Valable jusqu'au 14/03/2027", confidence: 0.9 };
  documentCalls = 0;
  failDocument = false;
  async analyzeLetter(): Promise<never> {
    throw new Error("StubLlm.analyzeLetter not implemented");
  }
  async analyzeDocument() {
    this.documentCalls++;
    if (this.failDocument) throw new Error("stub failure");
    return this.nextDocument;
  }
  async detectLanguage() {
    return { language: "fr" as LanguageCode, confidence: 1 };
  }
  async translateLetterText(input: { fr: import("@wilson/contracts").LetterText }) {
    return input.fr;
  }
  async planChat() {
    return { intent: "info" as const, frenchQuery: "", needsHuman: false };
  }
  async chatReply() {
    return { text: "stub", textFr: "stub", usedIds: [] as string[] };
  }
  async translateText(input: { text: string }) {
    return input.text;
  }
  async orientLetter(input: { analysis: import("@wilson/contracts").LetterAnalysis }) {
    return { fr: input.analysis.fr.orientation, target: input.analysis.target.orientation, usedIds: [] as string[] };
  }
}

/** Transport stub recording what would have been sent. */
export class StubTransport implements WhatsAppTransport {
  readonly mode = "sandbox" as const;
  readonly texts: { to: string; body: string }[] = [];
  readonly templates: { to: string; template: string; params: string[] }[] = [];
  async sendText(to: string, body: string) {
    this.texts.push({ to, body });
    return { waMessageId: `stub-${this.texts.length}` };
  }
  async sendTemplate(to: string, template: string, _language: LanguageCode, params: string[]) {
    this.templates.push({ to, template, params });
    return { waMessageId: `stub-tpl-${this.templates.length}` };
  }
  async downloadMedia(): Promise<{ bytes: Buffer; mimeType: string }> {
    return { bytes: Buffer.from("stub"), mimeType: "image/jpeg" };
  }
}

export interface TestCtx {
  deps: Deps;
  config: Config;
  queue: InlineQueue;
  blobs: MemoryBlobStore;
  clock: TestClock;
  llm: StubLlm;
  wa: StubTransport;
  services: Services;
  /** Drops the test database and closes the pool. */
  close(): Promise<void>;
}

export function testConfig(overrides: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: FALLBACK_URL,
    MASTER_KEY: randomBytes(32).toString("base64"),
    LOOKUP_KEY: randomBytes(32).toString("base64"),
    S3_ENDPOINT: "http://localhost:9000",
    S3_ACCESS_KEY: "x",
    S3_SECRET_KEY: "y",
    WHATSAPP_MODE: "sandbox",
    LLM_MODE: "fake",
    ...overrides,
  });
}

/**
 * Builds Deps on a fresh, migrated Postgres database (own database per call so test files can run in parallel;
 * falls back to resetting `wilson_test` if the role cannot create databases). Fixed clock, in-memory blobs, inline queue.
 */
export async function makeTestDeps(opts: { now?: string; config?: Record<string, string | undefined> } = {}): Promise<TestCtx> {
  let url = FALLBACK_URL;
  let dropName: string | null = null;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
    dropName = `wilson_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await admin.query(`CREATE DATABASE ${dropName}`);
    url = ADMIN_URL.replace(/\/[^/]*$/, `/${dropName}`);
  } catch {
    dropName = null;
    const c = new pg.Client({ connectionString: FALLBACK_URL });
    await c.connect();
    await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await c.end();
  } finally {
    await admin.end().catch(() => undefined);
  }

  const config = testConfig({ DATABASE_URL: url, ...opts.config });
  const { db, pool } = createDb(url);
  await migrate(db);
  const clock = new TestClock(new Date(opts.now ?? "2026-11-06T12:00:00Z"));
  const queue = new InlineQueue();
  const blobs = new MemoryBlobStore();
  const llm = new StubLlm();
  const wa = new StubTransport();
  const deps: Deps = { config, db, crypto: createCrypto(config), blobs, llm, wa, jobs: queue, now: clock.now };
  return {
    deps, config, queue, blobs, clock, llm, wa,
    services: getServices(deps),
    async close() {
      await pool.end();
      if (dropName) {
        const a = new pg.Client({ connectionString: ADMIN_URL });
        await a.connect();
        await a.query(`DROP DATABASE IF EXISTS ${dropName} WITH (FORCE)`);
        await a.end();
      }
    },
  };
}

export async function createVolunteer(
  deps: Deps,
  v: { email?: string; password?: string; name?: string; role?: "volunteer" | "admin" } = {},
) {
  const password = v.password ?? "correct-horse-1";
  const [row] = await deps.db
    .insert(volunteers)
    .values({ email: v.email ?? `v${randomUUID().slice(0, 6)}@example.org`, name: v.name ?? "Test Volunteer", role: v.role ?? "volunteer", passwordHash: await hashPassword(password) })
    .returning();
  return { ...row!, password };
}

/** In-process oRPC client with a cookie jar: `login` stores the session token like a browser would. */
export function makeClient(deps: Deps) {
  const jar: { token: string | null } = { token: null };
  const client = createRouterClient(router, {
    context: (): Promise<RpcContext> =>
      createContext(deps, jar.token, (t) => {
        jar.token = t;
      }),
  }) as unknown as ContractRouterClient<typeof contract>;
  return { client, jar };
}

export const PNG_BYTES = Buffer.from("89504e470d0a1a0a", "hex");
