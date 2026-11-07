# Mon courrier — Architecture (POC)

Status: v0.2. Open questions answered by the association on 2026-11-06 (see §12).

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
│  ├─ api/            Bun: oRPC server, WhatsApp webhook, workers (pg-boss), Drizzle schema + migrations
│  └─ backoffice/     React + TanStack Query, oRPC client, bundled fonts; built and served by Bun (serve.ts)
├─ prompts/           versioned LLM prompts (letter-analysis.v1.md, document-classify.v1.md, language-detect.v1.md)
└─ samples/letters/   10 synthetic letters (.md source + rendered .png) + expected facts for tests
```

## 3. Runtime topology (`docker compose up`)

```
 WhatsApp (Meta Cloud API) ──POST /webhooks/whatsapp──┐
 Back-office sandbox page ──oRPC sandbox.send─────────┤  (same parsed WaWebhook payload)
                                                      ▼
   ┌────────────────────────────── api (Bun) ──────────────────────────────┐
   │ HTTP: /rpc/* (oRPC) · /webhooks/whatsapp · /health                     │
   │ Conversation engine (state machine per beneficiary)                    │
   │ Workers (pg-boss): letter.analyze · document.analyze · wa.send ·       │
   │                    reminders.dispatch (cron) · media.purge (cron)      │
   └──────┬───────────────────────┬───────────────────────┬────────────────┘
          ▼                       ▼                       ▼
   PostgreSQL 17           SeaweedFS (S3)           LLM provider (default: Anthropic API, Claude Opus)
   data + pg-boss queues   encrypted blobs only     behind the generic LlmProvider interface
   backoffice (Bun.serve: dist/ + headers) ──/rpc──▶ api
```

- **Queue: pg-boss**, not BullMQ: it runs in the existing Postgres, so no Redis to host, back up or secure. Jobs are transactional with the data they describe.
- **Single API process** runs HTTP + workers in the POC (`API_ROLE=all`); can be split later with the same image.
- `RUNTIME=local` (`bun local`): no Docker at all — embedded Postgres (PGlite, WASM) with the same migrations, encrypted blobs on disk (`FsBlobStore`), in-process queue with timer crons. For testing on a laptop only.
- `WHATSAPP_MODE=sandbox|meta`. In sandbox, outbound messages are written to the `messages` table instead of calling Meta, and the back-office "Sandbox" page shows a fake phone. `LLM_MODE=anthropic|fake`: fake returns fixture analyses from `samples/letters/*.expected.json`, so the whole flow runs with no API keys at all.

## 4. Flows

### 4.1 First contact & language
1. Unknown `wa_id` → create `beneficiary` (new per-user data key, see §6).
2. If the first message is text, detect language with Opus (`language-detect.v1`, returns one of the 10 codes or `unknown`). If it is a photo or detection is unsure, send the **language menu**: a numbered list in native scripts (`1 Français · 2 English · 3 العربية …`). Numbers work on every keyboard.
3. Welcome message in that language, with the main menu: `1` explain a letter · `2` my documents · `3` change language · `0` talk to a person. The menu is shown again on any unrecognised text. Language can be changed at any time with `3` (or the word "language/langue/لغة…" catalogued in i18n).

### 4.2 Letter received → review → sent (critical path #1)
```
photo ─▶ webhook ─▶ download media (Meta) ─▶ encrypt with user DEK ─▶ S3 tmp/ ─▶ letters(status=received)
      ─▶ ack to user ("received, a volunteer will check the explanation, usually within X h")
      ─▶ job letter.analyze: decrypt → Opus vision + prompt letter-analysis.v1 → Zod-validate JSON
           (1 retry with the validation error fed back; else status=failed, shown in queue)
      ─▶ status=pending_review ─▶ back-office queue (sorted: urgency, deadline, age)
volunteer: read French version + photo, fix facts/prose ─▶ approve | reject
  approve ─▶ render target-language text (template + footer, §7) ─▶ job wa.send ─▶ status=sent
          ─▶ ask "Do you want to keep this letter in My documents? 1 yes 2 no"
  reject  ─▶ fixed message "a volunteer will contact you / come to the permanence" ─▶ status=rejected
photo purge: deleted as soon as the user answers "2", or at most PHOTO_TTL_HOURS after sending (default 48 h);
             answer "1" moves the blob to documents/ (type=letter). This is the only automatic deletion (brief constraint).
```
- The LLM returns **one JSON** with language-neutral facts (type, deadline, urgency) once, and prose twice: `fr` for the reviewer and `target` for the beneficiary (`LetterAnalysisSchema`).
- Reviewer reads and edits the French version. If `fr` was edited, approve first regenerates `target` from `fr` with the LLM (text-only call, logged as `retranslated`), then sends. No manual retranslate step: Opus translation quality is trusted for the POC.
- The outgoing text is never free LLM text: it is assembled from the fields by a fixed template, so the structure and the footer are guaranteed.

### 4.3 Document saved → reminder (critical path #2)
```
menu 2 ─▶ "send a photo or PDF of the document" ─▶ encrypt ─▶ S3 documents/ ─▶ job document.analyze
       ─▶ Opus: type + expiry date (+ verbatim quote) ─▶ ask user to confirm:
          "Récépissé, valid until 14 March 2027 (14 مارس ٢٠٢٧). 1 correct · 2 change the date"
       ─▶ 2 ─▶ user types a date (parsed leniently: 14/03/2027, 14-3-27…) ─▶ re-confirm in written-out form
       ─▶ documents row + reminders rows (d30, d7 at 10:00 Europe/Paris)
cron reminders.dispatch (every 15 min): due & scheduled rows ─▶ wa.send ─▶ status=sent (idempotent on reminder id)
date changed / document deleted ─▶ pending reminders cancelled and recreated
```
- Menu 2 also lists saved documents with their expiry dates, and lets the user delete one.
- Reminders are fixed i18n templates (no LLM), so they are sent without review.
- **24 h window:** outside WhatsApp's customer-service window, the API sends a Meta-approved *utility template* instead of free text: `explanation_ready` ("your explanation is ready, reply OK to receive it"; the reviewed text is sent when they reply) and `document_reminder` (type + written-out date). Template names are configured in env; their texts (16 languages Meta supports, with a fallback language for the others) live in `apps/api/src/whatsapp/templates.ts` and are submitted with `wa:setup templates`. A "Receive" quick-reply button on `explanation_ready` releases the waiting message. If Meta still answers 131047 (window closed) to a free-form send, the sender falls back to the template instead of retrying. The sandbox ignores the window. Real-number setup: `docs/whatsapp-setup.md`.
- Reminders whose date is already past at save time are skipped; an already-expired document triggers an immediate "expired, contact the association" message.

## 5. Data model (PostgreSQL, Drizzle)

`enc` = encrypted with the beneficiary's DEK (AES-256-GCM, app-level, stored as `bytea`).

| Table | Key columns |
|---|---|
| `beneficiaries` | id, `wa_id_hash` (HMAC-SHA256, lookup), `wa_id_enc`, language, `language_confirmed`, `conversation_state` jsonb (menu step), `wrapped_dek` (DEK encrypted by master key), created_at, last_message_at, deleted_at, chat_status, chat_assignee_id (volunteer holding the conversation) |
| `messages` | id, beneficiary_id, direction (in/out), wa_message_id, kind (text/image/document/template), `body_enc`, status (queued/sent/delivered/read/failed), created_at |
| `letters` | id, beneficiary_id, status, `photo_key` (nullable, nulled on purge), `analysis_enc` (LetterAnalysis JSON), `target_stale`, letter_type, urgency, deadline (plain, for sorting), low_confidence, received_at, reviewed_by, reviewed_at, sent_at |
| `letter_events` | id, letter_id, volunteer_id, action, note, at — review audit trail |
| `documents` | id, beneficiary_id, type, `label_enc`, expires_at, expiry_source, object_key, mime_type, size_bytes, sha256, created_at, archived_at, purge_at |
| `reminders` | id, document_id, kind (d30/d7), due_at, status, sent_at — unique (document_id, kind) |
| `volunteers` | id, email, password_hash (argon2id), name, role (responder/volunteer/admin), ui_language, disabled_at, pending_approval, signup_note, approved_at, approved_by |
| `volunteer_permissions` | volunteer_id, permission, granted (bool) — per-volunteer overrides on top of the role bundle (empty in the POC) |
| `sessions` | id (random, httpOnly cookie), volunteer_id, expires_at |
| `case_notes` | id, beneficiary_id, author_id, `body_enc`, created_at, edited_at — case notes on a person |
| `case_tasks` | id, beneficiary_id, created_by, assignee_id (null = anyone), `text_enc`, due_on (reminder day, Europe/Paris), status (open/done/cancelled), done_at, done_by |
| `volunteer_skills` | volunteer_id (PK), languages language[], skills volunteer_skill[], note, updated_at — about volunteers, clear text |
| `access_log` | volunteer_id, action (view_photo, view_document, edit…), target id, at — who looked at what |
| `llm_usage` | one row per Claude call: at, task (prompt name), model, language, beneficiary_id (opaque, set null on purge), api_key_id, input/output/cache tokens, `cost_micro_usd` (estimate from `llm/pricing.ts`). No prompt, reply, name or phone |
| `llm_api_keys` | admin-added Claude keys (donors): label, `key_enc` under the key's own DEK (wrapped by MASTER_KEY), last 4 chars, monthly limit, disabled_at, last error. The key is never returned to the back-office |
| `llm_budget` | single row: global monthly limit (USD cents) + hard stop flag |

Type, dates, urgency and status stay in clear so the queue can sort and filter; they are low-sensitivity and never include names. Names, phone numbers, letter content and document labels are encrypted.

### Claude usage, budgets and keys
Every Claude call goes through `AnthropicProvider.create`, which asks the usage meter (`src/usage/service.ts`) for a key and records tokens + estimated cost afterwards. Key choice: the oldest active admin-added key whose month-to-date cost is under its own limit, then the server key (`ANTHROPIC_API_KEY`). A key the API refuses (401/403, no credit) is noted and skipped for 30 min, and the call is retried on the next one. With the global hard stop on and the monthly budget reached, or with no key left, the provider throws `LlmError`: the chat hands the question to volunteers and the letter shows as failed, as for any LLM failure. Admins (`usage.manage`) see daily/monthly totals, a 30-day chart and breakdowns by task, language and model under Plus > Coûts de l'IA; Home shows a notice at 80 % and 100 % of the budget.

## 6. Security & GDPR

- **Encryption at rest, per user.** Each beneficiary gets a random 256-bit data key (DEK), stored only wrapped by `MASTER_KEY` (env/secret manager). Blobs are encrypted by the API with the DEK (AES-256-GCM) **before** upload to S3, and sensitive DB columns use the same DEK. Deleting a beneficiary deletes `wrapped_dek` → all their data is cryptographically unreadable (crypto-shredding), then rows/blobs are purged.
  *Decision:* app-level envelope encryption instead of S3 SSE-C. SSE-C still sends the key to the storage provider on each request and most self-hosted S3 servers only accept it over TLS; app-level encryption works on any EU S3 (Scaleway, OVH, Clever Cloud) and the provider never sees plaintext. The bucket additionally uses provider-side SSE-S3 in production.
- **Letter photos** are deleted after processing (§4.2), unless the user saves them to My documents.
- **Third parties:** only Meta (WhatsApp transport) and the LLM provider. No analytics, no CDN, fonts self-hosted, no external calls from the back-office.
- **Back-office:** cookie session (httpOnly, SameSite=Strict, Secure), argon2id passwords, phone numbers masked, every photo/document view logged.
- **Permissions:** procedures check fine-grained permissions (`letters.review`, `documents.view_file`, `volunteers.manage`… see `contracts/auth.ts`), never roles. Roles are named bundles (`ROLE_PERMISSIONS`); `volunteer_permissions` allows per-person grants/revocations later without code changes. POC: all volunteers get the full volunteer bundle.
- **Retention (association decision):** nothing is deleted automatically for now, except letter photos (above). When a user deletes a document, it is **archived** (hidden, reminders cancelled) and hard-deleted 30 days later by the `documents.purge` cron. "Delete all my data" (`9` in the menu) archives everything the same way; after 30 days the wrapped DEK is destroyed (crypto-shredding) and rows/blobs purged.
- **EU hosting:** Postgres + S3 + API run in the EU (compose locally; target: Scaleway/OVH in France).

## 7. Languages, RTL and rendering

- `packages/i18n` holds: the language table (code, native name, `dir`, Intl locale, script), WhatsApp catalogs for all 10 languages, back-office UI catalogs, and helpers. ICU message format with named placeholders, no string concatenation.
- **WhatsApp (plain text):** every embedded LTR fragment inside an RTL message (address, reference number, date, phone) and every RTL fragment inside LTR text is wrapped with FSI…PDI (U+2068 / U+2069) by `isolate()`. The template engine applies it to every placeholder automatically, so translators never handle control characters.
- **Dates:** always written out, never `DD/MM`. `formatDate(d, lang)` returns the locale long form with the locale's native digits **and** the same date with Western digits, e.g. `١٤ مارس ٢٠٢٧ (14 مارس 2027)`, `14 березня 2027 р.`; weekday included for deadlines. Relative hint added: "in 12 days".
- **Back-office:** `<html lang dir>` from the volunteer's UI language; content blocks (beneficiary text) carry their own `lang`/`dir`. Logical CSS properties only (`margin-inline-*`, `inset-inline-*`, `text-align: start`), lint rule forbids `left/right` in CSS. Icons with direction (arrows) are mirrored with `:dir(rtl)`.
- **Fonts, bundled locally** (woff2 subsets under `apps/backoffice/public/fonts`, OFL): Noto Sans (Latin, Cyrillic), Noto Sans Arabic (ar, ur UI), Noto Naskh Arabic (long ar/ur text), Vazirmatn (fa, ps), Noto Sans Ethiopic (ti, am). `@font-face` with `unicode-range` per script; `:lang()` selectors pick the family. Pashto/Dari letters (ټ ډ ړ ږ ښ ګ ڼ ۀ گ چ پ ژ) are checked by a script against each font's cmap at build time, plus the **language test page** (sample sentence, date, mixed RTL/LTR address per language).

## 8. LLM pipeline

- **Generic `LlmProvider` interface** (`apps/api/src/llm/provider.ts`): `analyzeLetter`, `analyzeDocument`, `detectLanguage`, `translateLetterText`. Implementations: `AnthropicProvider` (default model Claude Opus, `LLM_MODEL` env) and `FakeProvider` (fixtures). Adding Mistral, a Bedrock/Vertex EU region or a self-hosted model = one new class.
- Vision input (image or PDF), JSON output validated with the Zod schemas from `contracts` (one repair retry).
- Prompts in `/prompts/*.vN.md`, loaded by version; the version is stored in each analysis (`promptVersion`). Changing a prompt = new file, never an in-place edit.
- Rules enforced by the prompt **and** by code: structured JSON only; prose in the target language; no legal advice or prediction of outcome ("you will win", "you should appeal") — appeals and removal orders are flagged `urgency=high` with orientation to a jurist/association; deadlines must cite a verbatim quote; uncertainty goes into `reviewerWarnings`.
- No conversation history, no beneficiary identity is sent to the LLM: only the image and the target language.

## 8b. Knowledge base (RAG) for orientation

Goal: the "who to turn to" lines cite real, local, up-to-date offices and procedures instead of generic advice.

| Source | Licence | Content | Default |
|---|---|---|---|
| Service-Public.fr fiches pratiques (DILA, data.gouv.fr XML zip, daily) | Licence Ouverte 2.0 | Procedures: titres de séjour, asile, CAF, AME, logement, impôts, aide juridictionnelle… (allowlist in `knowledge/sources/servicePublicTopics.ts`) | on |
| Annuaire de l'administration (DILA, Opendatasoft API) | Licence Ouverte 2.0 | Local offices for `KNOWLEDGE_DEPARTMENTS`: préfecture, CAF, CPAM, Point-justice, France services… with address, phone, hours | on |
| Association notes (`knowledge/association/*.md`) | internal | The association's own permanences, partners, hours | on |
| Watizat guides (PDF dropped in `knowledge/watizat/`) | "tous droits réservés" | City guides for exiled people | **off until Watizat grants permission** (`KNOWLEDGE_ENABLE=watizat`) |
| data·inclusion, Refugies.info | access on request / licence unstated | — | not wired yet |

- **Storage & search:** `knowledge_chunks` table (public content only, never beneficiary data) with a generated French `tsvector` + GIN index; search = French full-text (`to_tsquery` OR of keywords, `ts_rank_cd`), contacts filtered to the département. Works identically on Postgres and PGlite. No embedding model and no external service, so nothing leaves the server. Embeddings (local model + pgvector) can be added behind `KnowledgeService.search` later.
- **Sync:** weekly cron + first start + `bun knowledge:sync [source]` + "Synchroniser" button (admin). Each sync upserts by `(source, external_id)` and deletes stale chunks.
- **Orientation step:** after `analyzeLetter`, query = French title + summary + issuer + per-type keywords → top procedures + local contacts → `llm.orientLetter` (prompt `letter-orientation.v1`) rewrites orientation in fr + target using only those snippets (association always first; never invents an address; no legal advice) → `analysis.sources` shown to the reviewer. Any failure keeps the original orientation and adds a reviewer warning.

## 8c. Chatbot

- Entry: main menu `4`, or any free text (not a menu number) in the main menu / chat / while waiting for a photo or file. Voice notes → "please write".
- `ChatService.handleMessage`: store inbound (+ French translation for volunteers) → `llm.planChat` (intent + French search query, last `CHAT_HISTORY_TURNS` turns of text only) → by intent: `urgent` fixed emergency text + needs_human; `human`/`legal` handoff (no answer on substance) + needs_human; `letter`/`document` redirect to the flows; `info`/`smalltalk`/`out_of_scope` → knowledge search → `llm.chatReply` (answer in the user's language + French, from snippets only) → `CHAT_MODE=review` (default): draft for volunteers, user told an answer is coming; `auto`: sent at once. Footer always appended.
- Volunteers (Conversations screen, `conversations.*`): approve/edit/reject drafts, reply in French (auto-translated), close handoffs. Every action logged.
- **Take-over** (`conversations.takeOver`, or the first manual `reply`): `chat_status = with_volunteer`, `chat_assignee_id = volunteer`. The beneficiary gets the fixed `chat_handoff` text (unless already sent by a needs_human handoff). While held, inbound text is stored + translated to French and `planChat` only tags the intent: no bot draft, no `chat_pending`; an `urgent` intent still sends the fixed `chat_urgent` numbers. Another volunteer gets CONFLICT unless `force` (logged as `take_over_forced`). `resolve` clears the assignee ("Rendre à l'assistant"). The attention list includes held conversations whose last message is the beneficiary's (`awaitingReply`); filter `mine` = held by me. Disabling a volunteer releases their conversations back to `needs_human`.

## 8d. Volunteer accounts and self-signup

- `auth.signup` (public, `VOLUNTEER_SIGNUP=on|off`): creates a `volunteers` row with `pending_approval = true`, role `responder`, the free-text `signup_note`. Same `{ ok: true }` answer whether or not the email exists (no enumeration; password hashed in both cases). Pending rows are capped (`VOLUNTEER_SIGNUP_MAX_PENDING`, CONFLICT `too_many_pending`). The form requires a confidentiality/no-legal-advice commitment.
- A pending account cannot log in (`auth.login` → FORBIDDEN only when the password is right, so the UI can say "waiting for approval") and never resolves a session.
### Case notes, follow-up tasks, skills directory
- **Notes and tasks** live on a person and are encrypted under that person's DEK (crypto-shredded with them). Shown on the person page and in a "Suivi" sheet on the conversation screen. Tasks have a reminder day: from that morning (Europe/Paris) they count in `tasks.dueCount` (badge on Plus > Tâches de suivi and a Home tile). No e-mail/push: reminders are in the back-office only.
- **Permissions** (each procedure needs exactly one, ownership checks answer FORBIDDEN): `notes.view` (read notes/tasks, Tâches screen), `notes.write` (add, edit/delete own notes, tick tasks), `notes.moderate` (edit/delete anyone's), `tasks.assign` (give a task to someone else; the assignee must be active and have `notes.view`, else CONFLICT `assignee_cannot_view`), `skills.view` (directory and suggestions), `skills.edit_own`. Defaults: responder = `skills.edit_own` only; volunteer = all but `notes.moderate`; admin = all. Per-person changes go through `volunteer_permissions`.
- Every read and write goes to `access_log` (`notes.view` with the person id, `notes.add`, `notes.edit_moderated`, `tasks.list:mine`, `tasks.update:status=done`, `skills.update_for`…).
- **Skills** (`VOLUNTEER_SKILLS`: interpreting, legal, asylum, social_rights, health, housing, forms, digital, driving, accompaniment) + languages. `skills.suggest` matches a person's language (not French) and the skills for their latest chat intent (`SKILLS_FOR_INTENT`: legal → legal + asylum, urgent → housing + accompaniment + health…); "Qui peut aider ?" on a conversation needing a person lists them and gives one a prefilled task. `matchVolunteers()` in `src/skills/service.ts` is reusable by other features.

- Admins (`volunteers.manage`, `volunteers.*`): list, approve with a role (`approved_at`, `approved_by`), reject (row deleted), set role, disable/enable (sessions deleted at once). Not on themselves. Every action in `access_log`.
- **Roles:** `responder` = `conversations.view`, `conversations.reply`, `knowledge.view` (no letters, photos, documents or beneficiary pages) — least privilege by default for people the association does not know yet; `volunteer` = full volunteer bundle; `admin`. Permissions are resolved per request, so a role change applies on the next click.

## 8e. Performance (low-end phones, slow connections)

Volunteers open the back-office on cheap phones and old PCs, often over mobile data; beneficiaries wait for the bot's
WhatsApp reply. What keeps it fast, and the tests that guard it:

- **Small first download.** The browser imports `@wilson/contracts/values` (plain lists, no zod) and
  `@wilson/i18n/dates` / `@wilson/i18n/doctypes` (no WhatsApp catalogs), never the package roots.
  `apps/backoffice/test/bundle.test.ts` fails if zod or the catalogs come back, or if the entry chunk passes 130 KB gzipped.
- **One chunk per screen.** `App.tsx` loads every screen except login and home with `lazyScreens` (`src/lib/lazy.tsx`):
  downloaded once logged in, in the background (skipped in data-saver mode), retried once on a dropped connection,
  with an error + reload button instead of a blank page if it still fails.
- **Compressed and cached.** `build.ts` writes `.br` and `.gz` copies of every text file; `serve.ts` sends them, and
  gzips JSON answers from the API. Hashed file names (scripts, styles, fonts and their stylesheet) are cached for a
  year; `index.html` is revalidated. A missing hashed file is a 404, never the HTML page.
- **Cheap polling.** Navigation badges poll counts (`conversations.attentionCount`), not lists.
- **Bot reply time.** The French translation of an inbound message runs in parallel with intent classification.
  `LLM_FAST_MODEL` (optional) sends the short calls a reply waits on (intent, language detection, chat translation) to
  a faster model; letter analysis and chat answers stay on `LLM_MODEL`.
- **Indexes** on every per-person lookup (messages, letters, documents, letter events).

## 9. API contract overview (`packages/contracts`)

oRPC contract, consumed by `implement(contract)` on the server and a typed client in the back-office. Every procedure requires a volunteer session except `auth.login`, `auth.signup` and `system.health`.

| Group | Procedures |
|---|---|
| `auth` | login, signup (public), logout, me, setUiLanguage |
| `letters` | list (by status, cursor), get, photo (File), edit, approve (auto-retranslates if French edited), reject |
| `beneficiaries` | list (search by last digits), get (documents + letters), setLanguage |
| `documents` | deadlines (within N days), file (File), update (type/label/expiry), archive |
| `sandbox` | send (text and/or file as a fake phone), thread, runReminders (as of a date), reset — only mounted when `WHATSAPP_MODE=sandbox` |
| `knowledge` | sources, search (same retrieval as the orientation step), sync (admin) |
| `conversations` | list (attention / mine / all), get, approveDraft, rejectDraft, reply (French → translated), takeOver, resolve |
| `volunteers` | list, approve, reject, setRole, setDisabled (admin) |
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
| D3 | Workspace packages export TS sources; Bun everywhere: package manager (`bun.lock`), runtime (api runs `.ts` directly), test runner (`bun test`), bundler and web server for the back-office (`Bun.build`, `Bun.serve`), argon2id via `Bun.password`. `tsc` only type-checks | One tool, no build step between packages in a POC |
| D4 | Numbered menus, not keywords | Work in every language and keyboard; low literacy friendly |
| D5 | Outgoing text = template(fields) + fixed footer | Guarantees orientation pointer and structure; LLM never writes the whole message |
| D6 | Webhook as plain HTTP route with contract-defined Zod schema | Meta imposes format + raw-body signature |
| D7 | Back-office UI in fr + en + ar first, WhatsApp catalogs in all 10 | Volunteers are francophone; ar proves RTL UI; beneficiary-facing text is what must be in all languages. Machine-drafted translations flagged for native review |
| D8 | SeaweedFS as local S3 instead of MinIO | MinIO no longer publishes Docker images; any EU S3 provider works in production (only the endpoint changes) |
| D9 | Self-signup lands pending with role `responder` (conversations only) | Strangers can register; nothing sensitive is visible until an admin approves, and letters/documents need an explicit promotion |
| D10 | Take-over silences the bot instead of drafting in parallel | A beneficiary talking to a person must not get interleaved machine answers; the emergency numbers remain the only automatic text |

## 12. Answers from the association (2026-11-06)

1. LLM: generic interface; Anthropic API for the POC, other models later.
2. Translation: use Claude Opus, trust its translation; no manual retranslate gate.
3. 24 h window: Meta templates as proposed.
4. Access: all volunteers see everything for now (logged); fine-grained permissions prepared.
5. Retention: no automatic deletion for now; user deletions archived 30 days, then deleted.
