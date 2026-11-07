// Production bundle of the back-office: `bun run build` → dist/ (minified JS/CSS, fonts copied, no CDN).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFonts } from "./fonts";

export async function buildBackoffice(outdir = join(import.meta.dir, "dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "index.html")],
    outdir,
    minify: true,
    target: "browser",
    naming: { asset: "assets/[name]-[hash].[ext]", chunk: "assets/[name]-[hash].[ext]", entry: "[name].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("back-office build failed");
  }
  const fonts = writeFonts(outdir);
  writeBrand(outdir);
  console.log(`back-office built: ${result.outputs.length} files + ${fonts} fonts in ${outdir}`);
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
