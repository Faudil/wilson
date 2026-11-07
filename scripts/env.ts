// Shared by local.ts and knowledge-sync.ts: read KEY=VALUE lines from .env.local.
import { existsSync, readFileSync } from "node:fs";

export function readEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}
