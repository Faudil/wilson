import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";
import { createDb } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Applies pending SQL migrations from apps/api/drizzle. */
export async function migrate(db: Db): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder });
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const { db, pool } = createDb(url);
  await migrate(db);
  await pool.end();
  console.log("migrations applied");
}
