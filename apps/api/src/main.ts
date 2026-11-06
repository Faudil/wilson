import { loadConfig } from "./config.js";
import { createCrypto } from "./crypto/keysImpl.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import type { Deps } from "./deps.js";
import { PgBossQueue } from "./jobs/queue.js";
import { registerWorkers } from "./jobs/workers.js";
import { createLettersService } from "./letters/service.js";
import { createLlmProvider } from "./llm/index.js";
import { createHttpServer } from "./server.js";
import { adoptServices, getServices } from "./services.js";
import { S3BlobStore } from "./storage/s3.js";
import { createTransport, registerWaDeps, type WaDeps } from "./whatsapp/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);

  await migrate(db);
  if (process.env.SEED_ADMIN_EMAIL) console.log("seed:", await seed(db));

  const blobs = new S3BlobStore(config);
  await blobs.ensureBucket();

  const queue = new PgBossQueue(config.DATABASE_URL, config.TIMEZONE);
  await queue.start();

  const base = { config, db, crypto: createCrypto(config), blobs, llm: createLlmProvider(config), jobs: queue, now: () => new Date() };
  const { beneficiaries, documents } = getServices(base);
  const deps: Deps = { ...base, wa: createTransport({ ...base, beneficiaries }) };
  const letters = createLettersService(deps, beneficiaries);
  const waDeps: WaDeps = { ...deps, beneficiaries, documents, letters };
  adoptServices(base, deps, waDeps);
  registerWaDeps(waDeps);

  await registerWorkers(waDeps, queue);

  const server = createHttpServer(waDeps);
  server.listen(config.PORT, () => console.log(`api listening on :${config.PORT} (whatsapp=${config.WHATSAPP_MODE}, llm=${config.LLM_MODE})`));

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
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
