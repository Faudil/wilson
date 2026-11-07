import { z } from "zod";

/** "false", "0", "no", "off" (any case) → false; anything else non-empty → true. z.coerce.boolean() would make "false" true. */
const boolEnv = z.preprocess((v) => (typeof v === "string" ? !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase()) : v), z.boolean());

/** All runtime configuration. Parsed once at startup; the process exits on invalid config. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BACKOFFICE_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * server = Postgres + S3 + pg-boss (docker compose / production).
   * local  = no external services: embedded Postgres (PGlite, WASM) + encrypted files on disk + in-process queue.
   */
  RUNTIME: z.enum(["server", "local"]).default("server"),
  /** local runtime only: where the embedded database and encrypted blobs live. */
  DATA_DIR: z.string().default(".data"),
  DATABASE_URL: z.string().optional(),

  /** 32 bytes, base64. Wraps every beneficiary DEK. Never logged. */
  MASTER_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "MASTER_KEY must be 32 bytes base64"),
  /** 32 bytes, base64. HMAC key for phone-number lookup hashes. */
  LOOKUP_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "LOOKUP_KEY must be 32 bytes base64"),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  /** on = volunteers can request an account from the login page (an admin approves it); off = admins create accounts. */
  VOLUNTEER_SIGNUP: z.enum(["on", "off"]).default("on"),
  /** Self-signups waiting for approval are capped (anti-spam): beyond this, new requests are refused. */
  VOLUNTEER_SIGNUP_MAX_PENDING: z.coerce.number().int().min(1).default(30),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().default("wilson"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolEnv.default(true),

  WHATSAPP_MODE: z.enum(["sandbox", "meta"]).default("sandbox"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),
  /** WhatsApp Business Account id: only needed by `wa:setup` (templates, webhook subscription), not at runtime. */
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_TEMPLATE_EXPLANATION_READY: z.string().default("explanation_ready"),
  WHATSAPP_TEMPLATE_DOCUMENT_REMINDER: z.string().default("document_reminder"),

  // — Flood guard (src/whatsapp/guard.ts). Counts inbound messages per number and overall. —
  /** Per number: above these, messages are stored but not processed (no LLM) and the person is asked to slow down. */
  WA_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(8),
  WA_RATE_PER_HOUR: z.coerce.number().int().min(1).default(60),
  /** Per number: photos and PDFs in 24 h (each one is an expensive vision call). Above it, files are not analysed. */
  WA_FILES_PER_DAY: z.coerce.number().int().min(1).default(20),
  /** Per number: above these, the number is quarantined until a volunteer releases or blocks it. */
  WA_FLOOD_PER_MINUTE: z.coerce.number().int().min(2).default(20),
  WA_FLOOD_PER_HOUR: z.coerce.number().int().min(2).default(150),
  WA_FLOOD_PER_DAY: z.coerce.number().int().min(2).default(400),
  /** All numbers together: above these, first messages from numbers seen in the last 24 h are held for review. */
  WA_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  WA_GLOBAL_PER_HOUR: z.coerce.number().int().min(1).default(1500),

  /**
   * Optional security alerts (flood, quarantined numbers, unusual reads of personal data, login attacks): a webhook URL
   * receiving `{ "text": "...", "content": "..." }` (Mattermost, Slack, Discord, Rocket.Chat, ntfy…). Alerts never
   * contain names, phone numbers or message content. Unset = alerts only go to the server log.
   */
  ALERT_WEBHOOK_URL: z.url().optional(),

  LLM_MODE: z.enum(["anthropic", "fake"]).default("fake"),
  /** Server key, used after the keys admins add in the back-office (optional when such keys exist). */
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  /** Optional faster model for the short calls a WhatsApp reply waits on (intent, translation). Unset = LLM_MODEL. */
  LLM_FAST_MODEL: z.string().optional(),

  ASSOCIATION_NAME: z.string().default("Association Wilson"),
  /** Shown in every outgoing message footer: phone, address, opening hours. Plain text. */
  ASSOCIATION_CONTACT: z.string().default("01 23 45 67 89 · 12 rue de l'Exemple, 75010 Paris · lun-ven 9h-17h"),
  /** Département(s) whose local offices are loaded from the annuaire and preferred in search, comma-separated INSEE codes. */
  KNOWLEDGE_DEPARTMENTS: z.string().default("75"),
  /** Folder of the association's own Markdown notes + dropped-in guides (watizat/*.pdf). */
  KNOWLEDGE_DIR: z.string().default("knowledge"),
  /** Comma-separated source ids to enable on top of the defaults, e.g. "watizat" once permission is granted. */
  KNOWLEDGE_ENABLE: z.string().default(""),
  /** Override of the Service-Public.fr fiches archive (zip of XML) download URL. */
  SERVICE_PUBLIC_ZIP_URL: z.string().optional(),
  /** Annuaire de l'administration: pivot types loaded per département (comma-separated `type_service_local`). */
  ANNUAIRE_TYPES: z.string().default("prefecture,sous_pref,caf,cpam,point_justice,maison_justice,france_services,ofii,pole_emploi,france_travail,sip,mairie"),
  /** Turn the RAG orientation step off (analysis only). */
  RAG_ENABLED: boolEnv.default(true),
  /** review = every chatbot answer is a draft a volunteer approves (default); auto = sent at once (legal/urgent still to volunteers). */
  CHAT_MODE: z.enum(["review", "auto"]).default("review"),
  /** Max beneficiary turns kept as chat context for the LLM. */
  CHAT_HISTORY_TURNS: z.coerce.number().default(6),
  PHOTO_TTL_HOURS: z.coerce.number().default(48),
  ARCHIVE_RETENTION_DAYS: z.coerce.number().default(30),
  TIMEZONE: z.string().default("Europe/Paris"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid configuration:", z.prettifyError(parsed.error));
    process.exit(1);
  }
  const c = parsed.data;
  if (c.WHATSAPP_MODE === "meta" && !(c.WHATSAPP_ACCESS_TOKEN && c.WHATSAPP_APP_SECRET && c.WHATSAPP_PHONE_NUMBER_ID && c.WHATSAPP_VERIFY_TOKEN)) {
    console.error("WHATSAPP_MODE=meta requires WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN");
    process.exit(1);
  }
  if (c.RUNTIME === "server" && !(c.DATABASE_URL && c.S3_ENDPOINT && c.S3_ACCESS_KEY && c.S3_SECRET_KEY)) {
    console.error("RUNTIME=server requires DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY (or use RUNTIME=local)");
    process.exit(1);
  }
  if (c.LLM_MODE === "anthropic" && !c.ANTHROPIC_API_KEY) {
    console.warn("LLM_MODE=anthropic without ANTHROPIC_API_KEY: Claude calls use only the keys added in the back-office (Usage > API keys).");
  }
  return c;
}
