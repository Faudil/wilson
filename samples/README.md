# Samples

All content is synthetic: invented names, addresses, reference numbers and phone numbers. Any resemblance to real people or files is accidental.

## Layout

- `letters/NN-slug.{md,html,png,expected.json}` - 10 French official letters (préfecture convocation, OQTF, OFPRA convocation, OFPRA rejection, CAF, OFII ADA suspension, CPAM AME, France Travail, tax, housing arrears).
- `documents/dN-slug.{html,png,expected.json}` - 3 personal documents (récépissé, attestation de demande d'asile, attestation de domiciliation).
- `letters.data.ts` - single source of truth for the letters and documents (text, facts, fr/en/ar/fa prose).
- `build.ts` - generates `.md`, `.html` and `.expected.json` from the data (validates against the contracts' Zod schemas).
- `render.ts` - renders every `.html` to a 794x1123 PNG with Playwright.

Regenerate: `cd apps/api && npx tsx ../../samples/build.ts && npx tsx ../../samples/render.ts`.

## `letters/*.expected.json` shape

A valid `LetterAnalysis` (what the LLM must return, `promptVersion: "letter-analysis@1"`), plus one extra key:

```json
{
  "...LetterAnalysis fields": "...",
  "fr": { "title": "...", "summary": "...", "actions": [], "orientation": [] },
  "target": { "...": "English text, so the file alone is a valid LetterAnalysis" },
  "targets": { "en": LetterText, "ar": LetterText, "fa": LetterText /* only on 01 */ }
}
```

`targets` is only read by `FakeProvider`: for target language `L` it returns `targets[L]` as `target`; if `L` is `fr` it returns `fr`; otherwise the French text with every string prefixed `"[L] "`. The `targets` key is stripped before returning (and is ignored by `LetterAnalysisSchema`). Arabic and Dari/Persian texts are machine-drafted and need native review.

Deadline `sourceQuote`s are verbatim substrings of the matching `.md` (tests enforce it). Letters 02 and 04 have a computed deadline (`explicit: false`) with reviewer warnings, as the prompt requires.

## `documents/*.expected.json`

A valid `DocumentAnalysis` (`promptVersion: "document-analysis@1"`).

## Fixture lookup

`FakeProvider` matches the SHA-256 of the uploaded bytes against `letters/*.png|pdf|jpg` (resp. `documents/`) and returns the `*.expected.json` with the same basename. Any other file gets a generic `other_official`, confidence 0.3 analysis.
