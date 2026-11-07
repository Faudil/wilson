// Production bundle of the back-office: `bun run build` → dist/ (minified JS/CSS, fonts copied, no CDN).
// Every text file is also written pre-compressed (.br and .gz) so serve.ts sends ~4x fewer bytes without
// compressing on each request: what matters most on a slow phone connection.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { writeFonts } from "./fonts";

const COMPRESSIBLE = /\.(js|css|html|svg|json|webmanifest|txt)$/;

/** Write <file>.br and <file>.gz next to every compressible file of dir (recursively). Returns how many files. */
export function precompress(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!COMPRESSIBLE.test(entry)) continue;
    const path = join(dir, entry);
    const data = readFileSync(path);
    writeFileSync(`${path}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
    writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
    count++;
  }
  return count;
}

export async function buildBackoffice(outdir = join(import.meta.dir, "dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "index.html")],
    outdir,
    minify: true,
    splitting: true, // one chunk per lazily loaded screen (see src/lib/lazy.tsx)
    target: "browser",
    naming: { asset: "assets/[name]-[hash].[ext]", chunk: "assets/[name]-[hash].[ext]", entry: "[name].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("back-office build failed");
  }
  const fonts = writeFonts(outdir);
  // The fonts stylesheet goes in <head> so it downloads alongside the script instead of after it has run.
  const indexPath = join(outdir, "index.html");
  const html = readFileSync(indexPath, "utf8");
  writeFileSync(indexPath, html.replace("</head>", `<link rel="stylesheet" href="${fonts.href}"></head>`));
  writeBrand(outdir);
  const compressed = precompress(outdir); // last, so it covers everything written above
  console.log(`back-office built: ${result.outputs.length} files + ${fonts.count} fonts (${compressed} pre-compressed) in ${outdir}`);
}

/** Home-screen install: the manifest and its icons need stable URLs (Bun would hash them), so they are copied to dist/brand/. */
function writeBrand(outdir: string): void {
  const src = join(import.meta.dir, "src/brand");
  const dir = join(outdir, "brand");
  mkdirSync(dir, { recursive: true });
  for (const name of ["manifest.webmanifest", "mark.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) copyFileSync(join(src, name), join(dir, name));
  const html = join(outdir, "index.html");
  writeFileSync(html, readFileSync(html, "utf8").replace("</head>", '<link rel="manifest" href="/brand/manifest.webmanifest"></head>'));
}

if (import.meta.main) await buildBackoffice();
