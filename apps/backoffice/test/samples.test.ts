import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { LANGUAGE_CODES, LANGUAGES } from "@wilson/contracts";
import { SAMPLES } from "../src/lib/samples";

const fontsCss = readFileSync(join(__dirname, "../src/styles/fonts.css"), "utf8");

describe("language test samples", () => {
  it("has one non-empty sample per language", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...LANGUAGE_CODES].sort());
    for (const code of LANGUAGE_CODES) {
      const s = SAMPLES[code];
      expect(s.sentence.length, code).toBeGreaterThan(20);
      expect(s.addressLabel && s.referenceLabel, code).toBeTruthy();
    }
  });

  it("declares every font family named by a sample in fonts.css", () => {
    for (const code of LANGUAGE_CODES) {
      expect(fontsCss, `${code}: ${SAMPLES[code].font}`).toContain(`font-family: "${SAMPLES[code].font}"`);
    }
  });

  it("has a :lang() font rule for the scripts without a Latin-based font", () => {
    for (const code of ["bn", "ta", "ka", "hy", "ckb"]) expect(fontsCss).toContain(`:lang(${code})`);
    expect(LANGUAGES.ckb.dir).toBe("rtl");
  });
});
