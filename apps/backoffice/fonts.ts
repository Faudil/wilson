// Self-hosted fonts (no CDN). src/styles/fonts.css points at the @fontsource files in node_modules; we serve it as
// /fonts/fonts.css (dev) or /fonts/fonts-<hash>.css (production) with each url() rewritten to /fonts/<file>. Bun's bundler would inline every font as base64
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

/** First 8 hex digits of the content hash: the file name changes only when the file does, so browsers can cache it forever. */
function contentHash(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex").slice(0, 8);
}

/**
 * Write dist/fonts/fonts-<hash>.css and copy the font files next to it as <name>-<hash>.woff2 (served as immutable).
 * Returns the stylesheet's URL, which build.ts puts in index.html.
 */
export function writeFonts(outdir: string): { href: string; count: number } {
  const { css, files } = fontAssets();
  const dir = join(outdir, "fonts");
  mkdirSync(dir, { recursive: true });
  let hashedCss = css;
  for (const [name, path] of files) {
    const hashed = name.replace(/\.(\w+)$/, `-${contentHash(readFileSync(path))}.$1`);
    copyFileSync(path, join(dir, hashed));
    hashedCss = hashedCss.replaceAll(`/fonts/${name}"`, `/fonts/${hashed}"`);
  }
  const cssName = `fonts-${contentHash(hashedCss)}.css`;
  writeFileSync(join(dir, cssName), hashedCss);
  return { href: `/fonts/${cssName}`, count: files.size };
}
