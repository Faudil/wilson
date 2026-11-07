CREATE TYPE "public"."guard_reason" AS ENUM('flood', 'global_flood', 'manual');--> statement-breakpoint
CREATE TYPE "public"."guard_status" AS ENUM('none', 'quarantined', 'blocked');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'numbers.moderate';--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "guard_status" "guard_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "guard_reason" "guard_reason";--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "guard_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "guard_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "email_verified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "email_token_hash" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "email_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_secret_enc" "bytea";--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_wrapped_dek" "bytea";--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_guard_by_volunteers_id_fk" FOREIGN KEY ("guard_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beneficiaries_guard_idx" ON "beneficiaries" USING btree ("guard_status","guard_at") WHERE "beneficiaries"."guard_status" <> 'none';