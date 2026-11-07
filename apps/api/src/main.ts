import { loadConfig } from "./config.js";
import { createCrypto } from "./crypto/keysImpl.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import type { Db } from "./db/client.js";
import type { Deps } from "./deps.js";
import { PgBossQueue, type WorkerQueue } from "./jobs/queue.js";
import { FsBlobStore } from "./local/fsBlobStore.js";
import { LocalQueue } from "./local/localQueue.js";
import { createLocalDb } from "./local/pglite.js";
import type { BlobStore } from "./storage/blobStore.js";
import { registerWorkers } from "./jobs/workers.js";
import { createLettersService } from "./letters/service.js";
import { createLlmProvider } from "./llm/index.js";
import { usageServiceFor } from "./usage/service.js";
import { createHttpServer } from "./server.js";
import { enqueueInitialSync } from "./knowledge/service.js";
import { adoptServices, getServices } from "./services.js";
import { S3BlobStore } from "./storage/s3.js";
import { createTransport, registerWaDeps, type WaDeps } from "./whatsapp/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  let db: Db;
  let blobs: BlobStore;
  let queue: WorkerQueue & { stop(): Promise<void> };
  let closeDb: () => Promise<void>;

  if (config.RUNTIME === "local") {
    // No Docker, no Postgres server, no S3: everything lives in DATA_DIR.
    const local = await createLocalDb(config.DATA_DIR);
    db = local.db;
    closeDb = local.close;
    blobs = new FsBlobStore(config.DATA_DIR);
    const q = new LocalQueue();
    q.start();
    queue = q;
  } else {
    const pg = createDb(config.DATABASE_URL!);
    db = pg.db;
    closeDb = () => pg.pool.end();
    await migrate(db);
    const s3 = new S3BlobStore(config);
    await s3.ensureBucket();
    blobs = s3;
    const q = new PgBossQueue(config.DATABASE_URL!, config.TIMEZONE);
    await q.start();
    queue = q;
  }
  if (process.env.SEED_ADMIN_EMAIL) console.log("seed:", await seed(db));

  const now = () => new Date();
  const crypto = createCrypto(config);
  const usage = usageServiceFor({ db, crypto, config, now });
  const base = { config, db, crypto, blobs, llm: createLlmProvider(config, usage.meter), jobs: queue, now };
  const { beneficiaries, documents, knowledge } = getServices(base);
  const deps: Deps = { ...base, wa: createTransport({ ...base, beneficiaries }) };
  const letters = createLettersService(deps, beneficiaries, knowledge);
  const waDeps: WaDeps = { ...deps, beneficiaries, documents, letters };
  adoptServices(base, deps, waDeps);
  registerWaDeps(waDeps);

  await registerWorkers(waDeps, queue);
  // First start: index the knowledge base in the background (weekly refresh afterwards).
  await enqueueInitialSync(knowledge, queue, config).catch((err) => console.error("[knowledge] initial sync not queued:", err));

  const server = createHttpServer(waDeps);
  server.listen(config.PORT, () => console.log(`api listening on :${config.PORT} (runtime=${config.RUNTIME}, whatsapp=${config.WHATSAPP_MODE}, llm=${config.LLM_MODE})`));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down`);
    const forced = setTimeout(() => process.exit(1), 25_000);
    forced.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await queue.stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
