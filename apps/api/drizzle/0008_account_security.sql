ALTER TABLE "volunteers" ADD COLUMN "email_verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "email_token_hash" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "email_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_secret_enc" "bytea";--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_wrapped_dek" "bytea";--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_last_step" integer;