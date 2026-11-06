import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LanguageCode } from "@wilson/contracts";
import { renderLetterReply } from "@wilson/i18n";
import { FakeProvider, resolveSamplesDir } from "../src/llm/fake.js";

const FSI = "⁨";
const PDI = "⁩";
const RLM = "‏";
const ADDRESS = "12 rue de l'Exemple, 75010 Paris";
const SAMPLE = "01-prefecture-convocation-titre-sejour.png";

/** Removes every balanced FSI..PDI span (innermost first). Returns null if the isolates are unbalanced. */
function stripIsolates(s: string): string | null {
  let depth = 0;
  for (const ch of s) {
    if (ch === FSI) depth++;
    else if (ch === PDI && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/⁨[^⁨⁩]*⁩/g, "");
  } while (s !== prev);
  return s;
}

const STRONG_RTL = /^[֐-ࣿיִ-﷿ﹰ-﻿]/;

describe.each(["ar", "fa", "ps", "ur"] as LanguageCode[])("WhatsApp letter reply is bidi-safe in %s", (lang) => {
  it("every line starts RTL, Latin/digit runs are isolated, isolates are balanced", async () => {
    const bytes = readFileSync(join(resolveSamplesDir(), "letters", SAMPLE));
    const a = await new FakeProvider().analyzeLetter({ file: { bytes, mimeType: "image/png" } as never, targetLanguage: lang, today: "2026-11-06" });
    const text = { ...a.target, orientation: [`${ADDRESS}`, ...a.target.orientation] };
    const reply = renderLetterReply({
      lang, text, deadline: a.deadline, urgency: a.urgency, today: "2026-11-06",
      association: { name: "Association Wilson", contact: "01 23 45 67 89 · 12 rue de l'Exemple, 75010 Paris · lun-ven 9h-17h" },
    });

    // the address survives intact and isolated
    expect(reply).toContain(`${FSI}${ADDRESS}${PDI}`);
    // balanced
    const stripped = stripIsolates(reply);
    expect(stripped, "isolates must be balanced and never close before opening").not.toBeNull();

    // every non-empty line starts with RLM or a strong RTL character
    for (const line of reply.split("\n").filter((l) => l.length > 0)) {
      expect(line.startsWith(RLM) || STRONG_RTL.test(line), `line does not start RTL: ${JSON.stringify(line.slice(0, 30))}`).toBe(true);
    }

    // after removing isolated spans, no Latin letter or digit remains, except list enumerators ("1. ") and
    // a bare day count followed by an RTL word ("(بعد 14 أيام)", "(32 روز دیگر)"), which are weak characters inside an RTL run.
    const rest = stripped!
      .split("\n")
      .map((l) => l.replace(new RegExp(`^${RLM}?\\d+\\. `), ""))
      .join("\n")
      .replace(/(?<=[\u0600-\u06FF (])\d+(?= [\u0600-\u06FF])/g, "");
    const leaks = rest.match(/[A-Za-z0-9]+/g) ?? [];
    expect(leaks, "Latin/digit runs outside FSI..PDI").toEqual([]);
  });
});
