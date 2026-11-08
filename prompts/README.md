# Prompts

Versioned LLM prompts for "Wilson". File name: `<name>.v<N>.md`. The loader (`apps/api/src/llm/prompts.ts`) exposes the version string `<name>@<N>` (e.g. `letter-analysis@1`), which is stored in each analysis as `promptVersion`.

## Versioning rule

**Never edit a released version.** Any change to wording, rules or JSON shape = a new file `<name>.v2.md` (copy, then edit), and the code is switched to the new version explicitly. Old analyses keep pointing at the version that produced them. Typo fixes in an unreleased draft are fine; once a version has produced a stored analysis, it is frozen.

## Placeholders

`{{today}}` (YYYY-MM-DD, Europe/Paris), `{{targetLanguageName}}` (English name, e.g. "Arabic"), `{{targetLanguageCode}}`, `{{languageList}}` (supported codes), plus `{{text}}` (language-detect) and `{{frJson}}` (letter-translate), `{{inputJson}}` (letter-orientation, chat-reply), `{{historyJson}}` (chat-plan), `{{fromName}}` (chat-translate). Rendering fails if a placeholder in the file has no value.

## Files

- `letter-analysis.v1.md` - vision: explain an official letter (fr prose for the reviewer + target prose).
- `document-analysis.v1.md` - vision: classify a personal document and read its expiry date.
- `language-detect.v1.md` - text: detect the language of a message.
- `letter-translate.v1.md` - text: translate reviewer-edited French prose.
- `chat-plan.v1.md` - text: classify the latest chat message (`ChatIntentSchema`) + French knowledge-base query + `needsHuman`; returns `{intent, frenchQuery, needsHuman}`.
- `chat-reply.v1.md` - text (RAG): chatbot answer in the target language AND French (<= 900 chars) from snippets only, association pointer, no legal advice, never invents addresses/phones/hours, never asks for personal data; returns `{text, textFr, usedIds}`.
- `chat-translate.v1.md` - text: plain translation of one chat message (volunteer replies fr->target, beneficiary messages ->fr); returns the translated text only.
- `letter-orientation.v1.md` - text (RAG): rewrite the "who to turn to" lines from retrieved snippets (association first, nothing invented, never legal advice); returns `{fr, target, usedIds}`.

## Non-negotiable rules (all letter prompts)

JSON only; explain / orient / remind, never legal advice or outcome prediction; OQTF, appeals, OFPRA/CNDA decisions are urgency high with orientation to the association or a lawyer; deadlines quote the French text verbatim; uncertainty goes to `reviewerWarnings`.
