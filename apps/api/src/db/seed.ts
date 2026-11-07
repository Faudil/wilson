import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/service.js";
import type { Db } from "./client.js";
import { createDb } from "./client.js";
import { volunteers } from "./schema.js";

async function ensure(db: Db, v: { email: string; password: string; name: string; role: "admin" | "volunteer" }): Promise<boolean> {
  const email = v.email.trim().toLowerCase();
  const [existing] = await db.select({ id: volunteers.id }).from(volunteers).where(eq(volunteers.email, email));
  if (existing) return false;
  await db.insert(volunteers).values({ email, name: v.name, role: v.role, passwordHash: await hashPassword(v.password) });
  return true;
}

/** Idempotent: creates the admin (and, outside production, a demo volunteer) if missing. */
export async function seed(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<{ created: string[] }> {
  const created: string[] = [];
  const email = env.SEED_ADMIN_EMAIL;
  const password = env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (await ensure(db, { email, password, name: "Administrateur", role: "admin" })) created.push(email);
  }
  if (env.NODE_ENV !== "production") {
    const demo = "benevole@example.org";
    if (await ensure(db, { email: demo, password: "benevole-demo-1", name: "Bénévole Démo", role: "volunteer" })) created.push(demo);
  }
  return { created };
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const { db, pool } = createDb(url);
  const r = await seed(db);
  await pool.end();
  console.log(r.created.length ? `seeded: ${r.created.join(", ")}` : "nothing to seed");
}
