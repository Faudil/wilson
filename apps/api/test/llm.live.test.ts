import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { AnthropicProvider } from "../src/llm/anthropic.js";
import { resolveSamplesDir } from "../src/llm/fake.js";

const key = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!key)("AnthropicProvider (live, costs money)", () => {
  const provider = () => new AnthropicProvider({ apiKey: key, model: process.env.LLM_MODEL ?? "claude-opus-5-5" });
  const dir = join(resolveSamplesDir(), "letters");

  it("OQTF letter: high urgency, appeal deadline", async () => {
    const a = await provider().analyzeLetter({
      file: { bytes: readFileSync(join(dir, "02-prefecture-oqtf.png")), mimeType: "image/png" },
      targetLanguage: "en",
      today: "2026-11-06",
    });
    expect(a.letterType).toBe("prefecture_removal_order");
    expect(a.urgency).toBe("high");
  }, 120_000);

  it("CAF letter: explicit deadline 2026-11-20", async () => {
    const a = await provider().analyzeLetter({
      file: { bytes: readFileSync(join(dir, "05-caf-demande-pieces.png")), mimeType: "image/png" },
      targetLanguage: "ar",
      today: "2026-11-06",
    });
    expect(a.deadline?.date).toBe("2026-11-20");
  }, 120_000);
});
