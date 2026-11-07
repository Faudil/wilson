/**
 * Re-index the knowledge base from the command line.
 *   pnpm knowledge:sync                 every enabled source
 *   pnpm knowledge:sync service_public  one source
 * RUNTIME=local uses the embedded database in DATA_DIR (stop the server first: PGlite is single-process).
 */
import { KnowledgeSourceIdSchema } from "@wilson/contracts";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { createLocalDb } from "../local/pglite.js";
import { createKnowledgeService } from "./service.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-") && a !== "--");
  const only = arg ? KnowledgeSourceIdSchema.parse(arg) : null;
  let db;
  let close: () => Promise<void>;
  if (config.RUNTIME === "local") {
    const local = await createLocalDb(config.DATA_DIR);
    db = local.db;
    close = local.close;
  } else {
    const pg = createDb(config.DATABASE_URL!);
    db = pg.db;
    close = () => pg.pool.end();
    await migrate(db);
  }
  const service = createKnowledgeService({ db, config });
  let failed = 0;
  try {
    const sources = (await service.listSources()).filter((s) => (only ? s.id === only : s.enabled));
    for (const s of sources) {
      try {
        console.log(`${s.id}: ${await service.sync(s.id)} chunks`);
      } catch (err) {
        failed++;
        console.error(`${s.id}: FAILED — ${(err as Error).message}`);
      }
    }
  } finally {
    await close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
