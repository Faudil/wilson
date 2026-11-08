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
  /** Association autocomplete on the sign-up form (official register, server-side). off = free text only. */
  ASSOCIATION_SEARCH: z.enum(["on", "off"]).default("on"),
  ASSOCIATION_SEARCH_URL: z.string().url().default("https://recherche-entreprises.api.gouv.fr/search"),
  /**
   * "Mon espace": people can create a web account (a name + recovery words, no phone) at /moi. off = the page only
   * signs in existing accounts. Sign-ups per IP per hour are generous because a whole permanence shares one IP.
   */
  BENEFICIARY_SIGNUP: z.enum(["on", "off"]).default("on"),
  WEB_SIGNUP_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
  WEB_SIGNUP_PER_DAY: z.coerce.number().int().min(1).default(300),
  /** Wrong recovery words / unlock codes: per IP (15 min), and for everyone together per hour (then refused + alert). */
  WEB_LOGIN_FAILURES_PER_IP: z.coerce.number().int().min(1).default(10),
  WEB_LOGIN_FAILURES_PER_HOUR: z.coerce.number().int().min(1).default(300),
  /** Web space session length; "this phone is shared" sessions last one hour. */
  WEB_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /** Signup requests accepted per IP address per hour, and in total per day. */
  SIGNUP_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(3),
  SIGNUP_PER_DAY: z.coerce.number().int().min(1).default(20),
  /**
   * required = accounts holding admin permissions (volunteers, audit, usage, knowledge sync, moderation) must enrol an
   * authenticator app; until then those permissions are withheld. optional = 2FA is offered but not enforced.
   */
  ADMIN_2FA: z.enum(["required", "optional"]).default("required"),
  /** Failed logins before an e-mail address is locked for LOGIN_LOCK_MINUTES (doubling each time), and per IP. */
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_MAX_FAILURES_PER_IP: z.coerce.number().int().min(1).default(20),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  /**
   * Reverse proxies in front of the back-office server (which adds its own hop). 1 = your nginx/Caddy/Traefik,
   * 2 = Cloudflare + your proxy. Used to find the visitor's IP in X-Forwarded-For for rate limits.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  /** smtp(s)://user:pass@host:port. When set, self-signups must click a link in an e-mail before an admin can approve. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Wilson <no-reply@localhost>"),
  /**
   * Unusual access: a volunteer opening more than this many different people's files, letters, conversations or notes
   * in one hour raises an alert. AUDIT_BULK_READ_ACTION=suspend also disables the account at once (an admin re-enables it).
   */
  AUDIT_READS_PER_HOUR: z.coerce.number().int().min(5).default(60),
  AUDIT_BULK_READ_ACTION: z.enum(["alert", "suspend"]).default("alert"),

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
  /** Marketing-category template that announces a broadcast outside the 24 h window ("Read" / "Stop" buttons). */
  WHATSAPP_TEMPLATE_ANNOUNCEMENT: z.string().default("announcement"),
  /**
   * Estimated price of one marketing template message, USD (Meta's rate card for France; check it, it changes).
   * Only used for the cost shown before an announcement is approved. Inside the 24 h window an announcement is a
   * service message: free for the first 1,000 per number per month, then about $0.03 in France (since Oct 2026).
   */
  WHATSAPP_PRICE_MARKETING_USD: z.coerce.number().min(0).default(0.0859),
  /** on = an announcement must be approved by someone other than its author. */
  BROADCAST_FOUR_EYES: boolEnv.default(true),

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

  /**
   * Nearby places (a shared WhatsApp location or a typed address → the nearest help). "osm" = OpenStreetMap
   * (Nominatim for addresses, Overpass for water, toilets, showers, pharmacies, stops) + Soliguide when a key is set;
   * "off" = only the list of the day. Only coordinates or the typed address leave the server, never who asked.
   */
  GEO_MODE: z.enum(["osm", "off"]).default("osm"),
  /** Search radius around the person, metres. */
  NEARBY_RADIUS_M: z.coerce.number().int().min(200).max(10_000).default(1500),
  /** Typed addresses are looked up in this country only (ISO 3166-1 alpha-2, comma-separated). */
  NEARBY_COUNTRIES: z.string().default("fr"),
  NOMINATIM_URL: z.url().default("https://nominatim.openstreetmap.org"),
  OVERPASS_URL: z.url().default("https://overpass-api.de/api/interpreter"),
  /** Contact address sent to Nominatim/Overpass with each request, as their usage policies ask. */
  OSM_CONTACT_EMAIL: z.string().optional(),
  /** Soliguide API token (free for associations, ask Solinum). Unset = no Soliguide results. */
  SOLIGUIDE_API_KEY: z.string().optional(),
  SOLIGUIDE_API_URL: z.url().default("https://api.soliguide.fr"),

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
