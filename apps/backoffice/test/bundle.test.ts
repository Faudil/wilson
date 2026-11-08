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

// The beneficiaries' web space: often opened on old phones with little data left.
const moi = await Bun.build({
  entrypoints: [join(import.meta.dir, "../src/moi/main.tsx")],
  minify: true,
  splitting: true,
  target: "browser",
  metafile: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

describe("web space bundle", () => {
  it("builds without zod or the WhatsApp catalogs, one chunk per language, first download under 110 KB gzipped", async () => {
    expect(moi.success).toBe(true);
    const outs = Object.values(moi.metafile!.outputs);
    const inputs = outs.flatMap((o) => Object.keys(o.inputs));
    expect(inputs.filter((p) => /node_modules\/(\.bun\/[^/]+\/node_modules\/)?zod\//.test(p))).toEqual([]);
    expect(inputs.filter((p) => p.includes("packages/i18n/src/catalogs/"))).toEqual([]);
    const entryOut = outs.find((o) => o.entryPoint)!;
    expect(Object.keys(entryOut.inputs).some((p) => p.includes("packages/i18n/src/web/ar"))).toBe(false);
    const main = moi.outputs.find((o) => o.kind === "entry-point")!;
    expect(gzipSync(Buffer.from(await main.arrayBuffer())).length).toBeLessThan(110 * 1024);
  });
});
