import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PromptName = "letter-analysis" | "document-analysis" | "language-detect" | "letter-translate";

/** Current released version of each prompt. Bump here (and add the vN file) to switch. */
export const PROMPT_VERSIONS: Record<PromptName, number> = {
  "letter-analysis": 1,
  "document-analysis": 1,
  "language-detect": 1,
  "letter-translate": 1,
};

/** e.g. "letter-analysis@1" — stored in each analysis as `promptVersion`. */
export const promptVersion = (name: PromptName, version: number = PROMPT_VERSIONS[name]): string => `${name}@${version}`;

let cachedDir: string | undefined;

/** Find the repo's /prompts directory: $PROMPTS_DIR, else walk up from this file and from cwd. */
export function resolvePromptsDir(): string {
  const fromEnv = process.env.PROMPTS_DIR;
  if (fromEnv) return resolve(fromEnv);
  if (cachedDir) return cachedDir;
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, "prompts");
      if (existsSync(join(candidate, "letter-analysis.v1.md"))) return (cachedDir = candidate);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Cannot find the prompts directory (set PROMPTS_DIR)");
}

export function loadPrompt(name: PromptName, version: number = PROMPT_VERSIONS[name]): string {
  const file = join(resolvePromptsDir(), `${name}.v${version}.md`);
  return readFileSync(file, "utf8");
}

/** Replace {{key}} placeholders. Throws if a placeholder has no value. Values are inserted literally. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`Missing prompt variable: ${key}`);
    return v;
  });
}

export function renderPrompt(name: PromptName, vars: Record<string, string>, version?: number): string {
  return renderTemplate(loadPrompt(name, version), vars);
}
