#!/usr/bin/env node
// Re-index the knowledge base (RAG) with the settings of .env.local:  pnpm knowledge:sync [service_public|annuaire|association|watizat]
// With the local runtime, stop `pnpm local` first (the embedded database allows a single process).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, ...readEnvFile(resolve(root, ".env.local")) };
env.RUNTIME ??= "local";
const r = spawnSync("pnpm", ["--filter", "@wilson/api", "knowledge:sync", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
