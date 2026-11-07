// Performance budget of the back-office: volunteers open it on low-end phones over mobile data.
// Fails when a change pulls server-only code into the browser or makes the first download much bigger.
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "../src/main.tsx")],
  minify: true,
  splitting: true,
  target: "browser",
  metafile: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
const outputs = Object.entries(result.metafile!.outputs);
const entry = outputs.find(([, o]) => o.entryPoint)!;

describe("browser bundle", () => {
  it("builds", () => expect(result.success).toBe(true));

  it("ships neither zod nor the WhatsApp catalogs (import @wilson/contracts/values and @wilson/i18n/dates instead)", () => {
    const inputs = outputs.flatMap(([, o]) => Object.keys(o.inputs));
    expect(inputs.filter((p) => /node_modules\/(\.bun\/[^/]+\/node_modules\/)?zod\//.test(p))).toEqual([]);
    expect(inputs.filter((p) => p.includes("packages/i18n/src/catalogs/"))).toEqual([]);
  });

  it("first download stays under 130 KB gzipped (screens are separate chunks)", async () => {
    const main = result.outputs.find((o) => o.kind === "entry-point")!;
    const gz = gzipSync(Buffer.from(await main.arrayBuffer())).length;
    expect(gz).toBeLessThan(130 * 1024);
    expect(Object.keys(entry[1].inputs).some((p) => p.includes("screens/LetterReview"))).toBe(false);
  });
});
