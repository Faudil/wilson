import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * KNOWLEDGE_DIR may be relative: try the working directory, then walk up to the repository root
 * (the API usually runs from apps/api while the folder lives at the repo root).
 */
export function resolveKnowledgeDir(dir: string, cwd = process.cwd()): string {
  if (isAbsolute(dir)) return dir;
  let cur = cwd;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(cur, dir);
    if (existsSync(candidate)) return candidate;
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return resolve(cwd, dir);
}

/** `---\nkey: value\n---` front matter (flat, optional quotes). */
export function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = src.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: m[2]! };
}
