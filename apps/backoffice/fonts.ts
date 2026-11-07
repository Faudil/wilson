// Self-hosted fonts (no CDN). src/styles/fonts.css points at the @fontsource files in node_modules; we serve it as
// /fonts/fonts.css with each url() rewritten to /fonts/<file>. Bun's bundler would inline every font as base64
// (1 MB of CSS), which defeats unicode-range: kept as separate files, the browser downloads only the scripts a page uses.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const cssPath = join(import.meta.dir, "src/styles/fonts.css");

export interface FontAssets {
  css: string;
  /** file name → absolute path in node_modules */
  files: Map<string, string>;
}

export function fontAssets(): FontAssets {
  const files = new Map<string, string>();
  const css = readFileSync(cssPath, "utf8").replace(/url\("([^"]+)"\)/g, (_, rel: string) => {
    const name = basename(rel);
    files.set(name, resolve(dirname(cssPath), rel));
    return `url("/fonts/${name}")`;
  });
  return { css, files };
}

/** Write dist/fonts/fonts.css and copy the font files next to it. */
export function writeFonts(outdir: string): number {
  const { css, files } = fontAssets();
  const dir = join(outdir, "fonts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fonts.css"), css);
  for (const [name, path] of files) copyFileSync(path, join(dir, name));
  return files.size;
}
