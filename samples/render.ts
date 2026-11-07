// Renders samples/{letters,documents}/*.html to PNG (794x1123, scale 1) with Playwright.
// Usage: bun samples/render.ts
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as any;
const here = dirname(fileURLToPath(import.meta.url));

async function main() {
const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  let n = 0;
  for (const dir of ["letters", "documents"]) {
    for (const f of readdirSync(join(here, dir)).filter((x) => x.endsWith(".html"))) {
      await page.goto(pathToFileURL(join(here, dir, f)).href);
      await page.screenshot({ path: join(here, dir, f.replace(/\.html$/, ".png")), clip: { x: 0, y: 0, width: 794, height: 1123 } });
      n++;
    }
  }
  await browser.close();
  console.log(`rendered ${n} PNGs`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
