// Re-index the knowledge base (RAG) with the settings of .env.local:  bun knowledge:sync [service_public|annuaire|association|watizat]
// With the local runtime, stop `bun local` first (the embedded database allows a single process).
import { join } from "node:path";
import { readEnvFile } from "./env";

const root = join(import.meta.dir, "..");
const env: Record<string, string | undefined> = { ...process.env, ...readEnvFile(join(root, ".env.local")) };
env.RUNTIME ??= "local";
const proc = Bun.spawn([process.execPath, "src/knowledge/cli.ts", ...process.argv.slice(2)], { cwd: join(root, "apps/api"), env, stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
