import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const releaseLock = acquireLock(resolve(dataDir, "db.lock"));
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    releaseLock();
    throw err;
  }
  return {
    db: db as unknown as Db,
    close: async () => {
      await client.close();
      releaseLock();
    },
  };
}

/**
 * PGlite is single-process: two servers on the same folder corrupt it. Refuse to start if another live process
 * holds the lock (a stale lock from a crashed process is taken over).
 */
function acquireLock(lockFile: string): () => void {
  try {
    const pid = Number(readFileSync(lockFile, "utf8"));
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(`The local database is already used by another Mon courrier process (pid ${pid}). Stop it first (Ctrl+C), then start again.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  writeFileSync(lockFile, String(process.pid));
  return () => rmSync(lockFile, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
