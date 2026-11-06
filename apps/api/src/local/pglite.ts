import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Local runtime: embedded Postgres (PGlite, WebAssembly) persisted in DATA_DIR/db.
 * Same schema and migrations as the server. The drizzle API is identical, so it is typed as Db.
 */
export async function createLocalDb(dataDir: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const dir = resolve(dataDir, "db");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
