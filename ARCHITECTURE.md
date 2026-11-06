# Mon courrier — Architecture (POC)

Status: draft v0.1, written before any implementation. Items marked **[Q]** depend on open questions to the association.

## 1. What it does

| Feature | Channel | Human in the loop |
|---|---|---|
| **Letter explanation**: photo of an official letter → explanation in the person's language (what it is, what to do, deadline, who to turn to) | WhatsApp | Every reply is reviewed by a volunteer before sending (copilot mode) |
| **My documents**: encrypted storage of attestation, récépissé, domiciliation…, with type + expiry date, reminders at D-30 and D-7 | WhatsApp | Volunteers can see the list and deadlines, fix a type/date |
| **Back-office** (mobile-first web): review queue, beneficiary documents & deadlines, language test page, WhatsApp sandbox | Browser | — |

Never legal advice: the system explains, orients and reminds. A fixed, non-LLM footer pointing to the association is appended to every outgoing message.

## 2. Repository layout

```
wilson/
├─ ARCHITECTURE.md · README.md · docker-compose.yml · .env.example
├─ packages/
│  ├─ contracts/      oRPC contract + Zod schemas (source of truth, no runtime deps besides zod/@orpc/contract)
│  └─ i18n/           languages, message catalogs (WhatsApp + UI), bidi helpers, date formatting
├─ apps/
│  ├─ api/            Node 22: oRPC server, WhatsApp webhook, workers (pg-boss), Drizzle schema + migrations
│  └─ backoffice/     React + Vite + TanStack Query, oRPC client, bundled fonts
├─ prompts/           versioned LLM prompts (letter-analysis.v1.md, document-classify.v1.md, language-detect.v1.md)
└─ samples/letters/   10 synthetic letters (.md source + rendered .png) + expected facts for tests
```

## 3. Runtime topology (`docker compose up`)

```
 WhatsApp (Meta Cloud API) ──POST /webhooks/whatsapp──┐
 Back-office sandbox page ──oRPC sandbox.send─────────┤  (same parsed WaWebhook payload)
                                                      ▼
   ┌──────────────────────────── api (Node 22) ────────────────────────────┐
   │ HTTP: /rpc/* (oRPC) · /webhooks/whatsapp · /health                     │
   │ Conversation engine (state machine per beneficiary)                    │
   │ Workers (pg-boss): letter.analyze · document.analyze · wa.send ·       │
   │                    reminders.dispatch (cron) · media.purge (cron)      │
   └──────┬───────────────────────┬───────────────────────┬────────────────┘
          ▼                       ▼                       ▼
   PostgreSQL 17           MinIO (S3 API)           Anthropic API (Claude Haiku, vision)
   data + pg-boss queues   encrypted blobs only     [Q1: direct vs EU-region provider]
   backoffice (nginx, static build) ──/rpc──▶ api
```

- **Queue: pg-boss**, not BullMQ: it runs in the existing Postgres, so no Redis to host, back up or secure. Jobs are transactional with the data they describe.
- **Single API process** runs HTTP + workers in the POC (`API_ROLE=all`); can be split later with the same image.
- `WHATSAPP_MODE=sandbox|meta`. In sandbox, outbound messages are written to the `messages` table instead of calling Meta, and the back-office "Sandbox" page shows a fake phone. `LLM_MODE=anthropic|fake`: fake returns fixture analyses from `samples/letters/*.expected.json`, so the whole flow runs with no API keys at all.

## 4. Flows

### 4.1 First contact & language
1. Unknown `wa_id` → create `beneficiary` (new per-user data key, see §6).
2. If the first message is text, detect language with Haiku (`language-detect.v1`, returns one of the 10 codes or `unknown`). If it is a photo or detection is unsure, send the **language menu**: a numbered list in native scripts (`1 Français · 2 English · 3 العربية …`). Numbers work on every keyboard.
3. Welcome message in that language, with the main menu: `1` explain a letter · `2` my documents · `3` change language · `0` talk to a person. The menu is shown again on any unrecognised text. Language can be changed at any time with `3` (or the word "language/langue/لغة…" catalogued in i18n).

### 4.2 Letter received → review → sent (critical path #1)
```
photo ─▶ webhook ─▶ download media (Meta) ─▶ encrypt with user DEK ─▶ S3 tmp/ ─▶ letters(status=received)
      ─▶ ack to user ("received, a volunteer will check the explanation, usually within X h")
      ─▶ job letter.analyze: decrypt → Haiku vision + prompt letter-analysis.v1 → Zod-validate JSON
           (1 retry with the validation error fed back; else status=failed, shown in queue)
      ─▶ status=pending_review ─▶ back-office queue (sorted: urgency, deadline, age)
volunteer: read French version + photo, fix facts/prose ─▶ approve | reject
  approve ─▶ render target-language text (template + footer, §7) ─▶ job wa.send ─▶ status=sent
          ─▶ ask "Do you want to keep this letter in My documents? 1 yes 2 no"
  reject  ─▶ fixed message "a volunteer will contact you / come to the permanence" ─▶ status=rejected
photo purge: deleted as soon as the user answers "2", or at most PHOTO_TTL_HOURS after sending (default 48 h);
             answer "1" moves the blob to documents/ (type=letter).
```
- The LLM returns **one JSON** with language-neutral facts (type, deadline, urgency) once, and prose twice: `fr` for the reviewer and `target` for the beneficiary (`LetterAnalysisSchema`).
- Reviewer edits in French; editing `fr` marks `target` stale; "Retranslate" regenerates `target` from the edited `fr` (text-only Haiku call); approve is refused while stale. **[Q2]**
- The outgoing text is never free LLM text: it is assembled from the fields by a fixed template, so the structure and the footer are guaranteed.

### 4.3 Document saved → reminder (critical path #2)
```
menu 2 ─▶ "send a photo or PDF of the document" ─▶ encrypt ─▶ S3 documents/ ─▶ job document.analyze
       ─▶ Haiku: type + expiry date (+ verbatim quote) ─▶ ask user to confirm:
          "Récépissé, valid until 14 March 2027 (14 مارس ٢٠٢٧). 1 correct · 2 change the date"
       ─▶ 2 ─▶ user types a date (parsed leniently: 14/03/2027, 14-3-27…) ─▶ re-confirm in written-out form
       ─▶ documents row + reminders rows (d30, d7 at 10:00 Europe/Paris)
cron reminders.dispatch (every 15 min): due & scheduled rows ─▶ wa.send ─▶ status=sent (idempotent on reminder id)
date changed / document deleted ─▶ pending reminders cancelled and recreated
```
- Menu 2 also lists saved documents with their expiry dates, and lets the user delete one.
- Reminders are fixed i18n templates (no LLM), so they are sent without review. **[Q3: Meta templates]**
- Reminders whose date is already past at save time are skipped; an already-expired document triggers an immediate "expired, contact the association" message.

## 5. Data model (PostgreSQL, Drizzle)

`enc` = encrypted with the beneficiary's DEK (AES-256-GCM, app-level, stored as `bytea`).

| Table | Key columns |
|---|---|
| `beneficiaries` | id, `wa_id_hash` (HMAC-SHA256, lookup), `wa_id_enc`, language, `language_confirmed`, `conversation_state` jsonb (menu step), `wrapped_dek` (DEK encrypted by master key), created_at, last_message_at, deleted_at |
| `messages` | id, beneficiary_id, direction (in/out), wa_message_id, kind (text/image/document/template), `body_enc`, status (queued/sent/delivered/read/failed), created_at. Kept for retention period **[Q5]** |
| `letters` | id, beneficiary_id, status, `photo_key` (nullable, nulled on purge), `analysis_enc` (LetterAnalysis JSON), `target_stale`, letter_type, urgency, deadline (plain, for sorting), low_confidence, received_at, reviewed_by, reviewed_at, sent_at |
| `letter_events` | id, letter_id, volunteer_id, action, note, at — review audit trail |
| `documents` | id, beneficiary_id, type, `label_enc`, expires_at, expiry_source, object_key, mime_type, size_bytes, sha256, created_at, deleted_at |
| `reminders` | id, document_id, kind (d30/d7), due_at, status, sent_at — unique (document_id, kind) |
| `volunteers` | id, email, password_hash (argon2id), name, role (volunteer/admin), ui_language, disabled_at |
| `sessions` | id (random, httpOnly cookie), volunteer_id, expires_at |
| `access_log` | volunteer_id, action (view_photo, view_document, edit…), target id, at — who looked at what |

Type, dates, urgency and status stay in clear so the queue can sort and filter; they are low-sensitivity and never include names. Names, phone numbers, letter content and document labels are encrypted.

## 6. Security & GDPR

- **Encryption at rest, per user.** Each beneficiary gets a random 256-bit data key (DEK), stored only wrapped by `MASTER_KEY` (env/secret manager). Blobs are encrypted by the API with the DEK (AES-256-GCM) **before** upload to S3, and sensitive DB columns use the same DEK. Deleting a beneficiary deletes `wrapped_dek` → all their data is cryptographically unreadable (crypto-shredding), then rows/blobs are purged.
  *Decision:* app-level envelope encryption instead of S3 SSE-C. SSE-C still sends the key to the storage provider on each request and MinIO only accepts it over TLS; app-level encryption works on any EU S3 (Scaleway, OVH, Clever Cloud) and the provider never sees plaintext. The bucket additionally uses provider-side SSE-S3 in production.
- **Letter photos** are deleted after processing (§4.2), unless the user saves them to My documents.
- **Third parties:** only Meta (WhatsApp transport) and the LLM provider. No analytics, no CDN, fonts self-hosted, no external calls from the back-office. **[Q1]**
- **Back-office:** cookie session (httpOnly, SameSite=Strict, Secure), argon2id passwords, roles volunteer/admin, phone numbers masked, every photo/document view logged. **[Q4]**
- **User rights via WhatsApp:** `9` in the menu → "delete all my data" with confirmation; executes crypto-shredding immediately.
- **EU hosting:** Postgres + S3 + API run in the EU (compose locally; target: Scaleway/OVH in France).

## 7. Languages, RTL and rendering

- `packages/i18n` holds: the language table (code, native name, `dir`, Intl locale, script), WhatsApp catalogs for all 10 languages, back-office UI catalogs, and helpers. ICU message format with named placeholders, no string concatenation.
- **WhatsApp (plain text):** every embedded LTR fragment inside an RTL message (address, reference number, date, phone) and every RTL fragment inside LTR text is wrapped with FSI…PDI (U+2068 / U+2069) by `isolate()`. The template engine applies it to every placeholder automatically, so translators never handle control characters.
- **Dates:** always written out, never `DD/MM`. `formatDate(d, lang)` returns the locale long form with the locale's native digits **and** the same date with Western digits, e.g. `١٤ مارس ٢٠٢٧ (14 مارس 2027)`, `14 березня 2027 р.`; weekday included for deadlines. Relative hint added: "in 12 days".
- **Back-office:** `<html lang dir>` from the volunteer's UI language; content blocks (beneficiary text) carry their own `lang`/`dir`. Logical CSS properties only (`margin-inline-*`, `inset-inline-*`, `text-align: start`), lint rule forbids `left/right` in CSS. Icons with direction (arrows) are mirrored with `:dir(rtl)`.
- **Fonts, bundled locally** (woff2 subsets under `apps/backoffice/public/fonts`, OFL): Noto Sans (Latin, Cyrillic), Noto Sans Arabic (ar, ur UI), Noto Naskh Arabic (long ar/ur text), Vazirmatn (fa, ps), Noto Sans Ethiopic (ti, am). `@font-face` with `unicode-range` per script; `:lang()` selectors pick the family. Pashto/Dari letters (ټ ډ ړ ږ ښ ګ ڼ ۀ گ چ پ ژ) are checked by a script against each font's cmap at build time, plus the **language test page** (sample sentence, date, mixed RTL/LTR address per language).

## 8. LLM pipeline

- Model: Claude Haiku via `@anthropic-ai/sdk`, vision input (image or PDF), JSON output validated with the Zod schemas from `contracts` (one repair retry).
- Prompts in `/prompts/*.vN.md`, loaded by version; the version is stored in each analysis (`promptVersion`). Changing a prompt = new file, never an in-place edit.
- Rules enforced by the prompt **and** by code: structured JSON only; prose in the target language; no legal advice or prediction of outcome ("you will win", "you should appeal") — appeals and removal orders are flagged `urgency=high` with orientation to a jurist/association; deadlines must cite a verbatim quote; uncertainty goes into `reviewerWarnings`.
- No conversation history, no beneficiary identity is sent to the LLM: only the image and the target language.

## 9. API contract overview (`packages/contracts`)

oRPC contract, consumed by `implement(contract)` on the server and a typed client in the back-office. Every procedure requires a volunteer session except `auth.login` and `system.health`.

| Group | Procedures |
|---|---|
| `auth` | login, logout, me, setUiLanguage |
| `letters` | list (by status, cursor), get, photo (File), edit, retranslate, approve, reject |
| `beneficiaries` | list (search by last digits), get (documents + letters), setLanguage |
| `documents` | deadlines (within N days), file (File), update (type/label/expiry), delete |
| `sandbox` | send (text and/or file as a fake phone), thread, runReminders (as of a date), reset — only mounted when `WHATSAPP_MODE=sandbox` |
| `system` | health |

The Meta webhook is the one HTTP route outside oRPC (format and signature imposed by Meta); its payload is still defined in `contracts/whatsapp.ts` and validated with Zod.

## 10. Testing

- **Contract tests** (`packages/contracts`): schemas accept/reject fixtures; server router implements every contract procedure (compile-time + runtime key check).
- **Critical path integration tests** (`apps/api`, real Postgres via compose/testcontainers, `LLM_MODE=fake`, `WHATSAPP_MODE=sandbox`): letter photo in → pending_review → approve → outbound text contains deadline, orientation footer, isolation marks; document saved → reminders created → `reminders.dispatch` at D-30 / D-7 sends exactly once.
- **i18n tests:** every key exists in every catalog; RTL messages with an embedded French address round-trip with FSI/PDI; date formatting for all 10 locales.
- **Prompt evals (optional, needs key):** run the 10 sample letters through the real model and compare against expected facts.

## 11. Decisions log

| # | Decision | Why |
|---|---|---|
| D1 | pg-boss over BullMQ | No Redis; one fewer service holding sensitive job payloads |
| D2 | App-level envelope encryption (per-user DEK) over S3 SSE-C | Provider-agnostic, provider never sees plaintext, enables crypto-shredding |
| D3 | Workspace packages export TS sources; api runs with `tsx`, back-office bundles with Vite | No build step between packages in a POC |
| D4 | Numbered menus, not keywords | Work in every language and keyboard; low literacy friendly |
| D5 | Outgoing text = template(fields) + fixed footer | Guarantees orientation pointer and structure; LLM never writes the whole message |
| D6 | Webhook as plain HTTP route with contract-defined Zod schema | Meta imposes format + raw-body signature |
| D7 | Back-office UI in fr + en + ar first, WhatsApp catalogs in all 10 | Volunteers are francophone; ar proves RTL UI; beneficiary-facing text is what must be in all languages. Machine-drafted translations flagged for native review |

## 12. Open questions

See the thread. Defaults used until answered: Q1 Anthropic API direct for the POC behind a provider interface; Q2 review in French + retranslate; Q3 sandbox ignores the 24 h window, Meta template names configurable; Q4 volunteers see metadata, file content viewable by all volunteers with access log; Q5 messages and analyses kept 90 days, documents until deleted or 12 months after last contact.
