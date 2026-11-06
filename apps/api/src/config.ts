import { z } from "zod";

/** All runtime configuration. Parsed once at startup; the process exits on invalid config. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BACKOFFICE_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string(),

  /** 32 bytes, base64. Wraps every beneficiary DEK. Never logged. */
  MASTER_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "MASTER_KEY must be 32 bytes base64"),
  /** 32 bytes, base64. HMAC key for phone-number lookup hashes. */
  LOOKUP_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "LOOKUP_KEY must be 32 bytes base64"),
  SESSION_TTL_HOURS: z.coerce.number().default(12),

  S3_ENDPOINT: z.string(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().default("wilson"),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  WHATSAPP_MODE: z.enum(["sandbox", "meta"]).default("sandbox"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),
  WHATSAPP_TEMPLATE_EXPLANATION_READY: z.string().default("explanation_ready"),
  WHATSAPP_TEMPLATE_DOCUMENT_REMINDER: z.string().default("document_reminder"),

  LLM_MODE: z.enum(["anthropic", "fake"]).default("fake"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),

  ASSOCIATION_NAME: z.string().default("Association Wilson"),
  /** Shown in every outgoing message footer: phone, address, opening hours. Plain text. */
  ASSOCIATION_CONTACT: z.string().default("01 23 45 67 89 · 12 rue de l'Exemple, 75010 Paris · lun-ven 9h-17h"),
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
  if (c.LLM_MODE === "anthropic" && !c.ANTHROPIC_API_KEY) {
    console.error("LLM_MODE=anthropic requires ANTHROPIC_API_KEY");
    process.exit(1);
  }
  return c;
}
