ALTER TABLE "beneficiaries" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
-- Web accounts (created before this column existed) are on the "web" channel.
UPDATE "beneficiaries" SET "channel" = 'web' WHERE "web_handle" IS NOT NULL;