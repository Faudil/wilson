// Production bundle of the back-office: `bun run build` → dist/ (minified JS/CSS, fonts copied, no CDN).
import { rmSync } from "node:fs";
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
  console.log(`back-office built: ${result.outputs.length} files + ${fonts} fonts in ${outdir}`);
}

if (import.meta.main) await buildBackoffice();
