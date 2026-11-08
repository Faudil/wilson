import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";

const SRC = join(__dirname, "../src");

function files(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p, ext) : ext.some((x) => p.endsWith(x)) ? [p] : [];
  });
}

/** Physical directions are forbidden: RTL languages must mirror automatically. Use margin-inline, inset-inline, text-align: start… */
const CSS_FORBIDDEN = /\b(left|right)\b|\bfloat\s*:|\bclear\s*:/i;
const TSX_FORBIDDEN =
  /\b(margin|padding|border)-?(Left|Right)\b|\b(left|right)\s*:|text-?align["']?\s*[:=]\s*["']?(left|right)|["'](left|right)["']|\bfloat\b/i;

const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|\s)\/\/.*$/gm, "$1");

function offenders(file: string, pattern: RegExp, strip: (s: string) => string): string[] {
  return strip(readFileSync(file, "utf8"))
    .split("\n")
    .flatMap((line, i) => (pattern.test(line) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : []));
}

describe("logical CSS only", () => {
  it("CSS has no left/right/float", () => {
    const css = files(SRC, [".css"]);
    expect(css.length).toBeGreaterThan(0);
    expect(css.flatMap((f) => offenders(f, CSS_FORBIDDEN, stripCssComments))).toEqual([]);
  });

  it("TSX has no physical style props or values", () => {
    const tsx = files(SRC, [".tsx", ".ts"]);
    expect(tsx.flatMap((f) => offenders(f, TSX_FORBIDDEN, stripTsComments))).toEqual([]);
  });

  it("the checker itself catches physical properties", () => {
    for (const bad of ["margin-left: 4px", "padding-right: 1px", "text-align: left", "border-top-left-radius: 2px", "left: 0", "float: right"]) {
      expect(CSS_FORBIDDEN.test(bad), bad).toBe(true);
    }
    for (const bad of ["marginLeft: 4", "paddingRight: 1", 'textAlign: "left"', "style={{ left: 0 }}"]) {
      expect(TSX_FORBIDDEN.test(bad), bad).toBe(true);
    }
    for (const ok of ["margin-inline-start: 4px", "text-align: start", "inset-inline-end: 0", "border-start-start-radius: 2px"]) {
      expect(CSS_FORBIDDEN.test(ok), ok).toBe(false);
    }
  });
});

describe("stylesheets", () => {
  it("close every block they open (an unclosed rule silently nests everything after it)", () => {
    for (const file of files(SRC, [".css"])) {
      let depth = 0;
      stripCssComments(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
        for (const ch of line) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
        expect(depth, `${relative(SRC, file)}:${i + 1}`).toBeGreaterThanOrEqual(0);
      });
      expect(depth, relative(SRC, file)).toBe(0);
    }
  });
});
