/**
 * Verifies that the bundled fonts really contain the letters we need (Pashto/Dari/Persian, Ethiopic).
 * Parses the .woff files from @fontsource directly (zlib tables + cmap formats 4 and 12), no dependency.
 * Run: pnpm --filter @wilson/backoffice check:fonts   (exit code 1 if any required glyph is missing)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(root, "package.json"));
const fontFile = (pkg: string, subset: string, weight = 400) =>
  join(dirname(req.resolve(`@fontsource/${pkg}/package.json`)), "files", `${pkg}-${subset}-${weight}-normal.woff`);

/** Set of code points covered by a WOFF 1 font. */
export function woffCodePoints(path: string): Set<number> {
  const buf = readFileSync(path);
  if (buf.toString("latin1", 0, 4) !== "wOFF") throw new Error(`${path}: not a WOFF 1 file`);
  const numTables = buf.readUInt16BE(12);
  let cmap: Buffer | null = null;
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    if (buf.toString("latin1", o, o + 4) !== "cmap") continue;
    const offset = buf.readUInt32BE(o + 4);
    const compLength = buf.readUInt32BE(o + 8);
    const origLength = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(offset, offset + compLength);
    cmap = compLength < origLength ? inflateSync(raw) : raw;
  }
  if (!cmap) throw new Error(`${path}: no cmap table`);

  const points = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        if (start === 0xffff) continue;
        const delta = cmap.readInt16BE(deltas + s * 2);
        const ro = cmap.readUInt16BE(rangeOffsets + s * 2);
        for (let c = start; c <= end; c++) {
          let glyph = 0;
          if (ro === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = cmap.readUInt16BE(rangeOffsets + s * 2 + ro + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) points.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const o = sub + 16 + g * 12;
        const start = cmap.readUInt32BE(o);
        const end = cmap.readUInt32BE(o + 4);
        for (let c = start; c <= end; c++) points.add(c);
      }
    }
  }
  return points;
}

const PASHTO_DARI = "ټډړږښګڼگچپژۀ";
const TIGRINYA = "ትግርኛ ቅድሚ መጋቢት ንፕረፈክቱር መልሲ ክትህቡን ኣለኩም";
const AMHARIC = "አማርኛ ከመጋቢት ቀን በፊት ለፕሪፌክቱሩ መልስ መስጠት አለብዎት";

type Check = { font: string; file: string; label: string; chars: string; required: boolean };
const checks: Check[] = [
  { font: "Vazirmatn", file: fontFile("vazirmatn", "arabic"), label: "ps/fa letters", chars: PASHTO_DARI, required: true },
  { font: "Noto Sans Arabic", file: fontFile("noto-sans-arabic", "arabic"), label: "ps/fa letters", chars: PASHTO_DARI, required: true },
  { font: "Noto Naskh Arabic", file: fontFile("noto-naskh-arabic", "arabic"), label: "ps/fa letters", chars: PASHTO_DARI, required: false },
  { font: "Noto Sans Ethiopic", file: fontFile("noto-sans-ethiopic", "ethiopic"), label: "ti sample", chars: TIGRINYA, required: true },
  { font: "Noto Sans Ethiopic", file: fontFile("noto-sans-ethiopic", "ethiopic"), label: "am sample", chars: AMHARIC, required: true },
];

let failed = false;
const rows: string[][] = [["font", "set", "covered", "missing"]];
for (const c of checks) {
  const cps = woffCodePoints(c.file);
  const wanted = [...new Set([...c.chars].filter((ch) => ch.trim() !== ""))];
  const missing = wanted.filter((ch) => !cps.has(ch.codePointAt(0)!));
  rows.push([c.font, c.label, `${wanted.length - missing.length}/${wanted.length}`, missing.length ? missing.join(" ") : "-"]);
  if (missing.length && c.required) failed = true;
}
const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => [...r[i]!].length)));
for (const [i, r] of rows.entries()) {
  console.log(r.map((cell, j) => cell + " ".repeat(widths[j]! - [...cell].length)).join("  |  "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("--+--"));
}
console.log(failed ? "\nFAIL: a required font lacks glyphs." : "\nOK: all required glyphs present.");
process.exit(failed ? 1 : 0);
