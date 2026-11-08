ALTER TYPE "public"."permission" ADD VALUE 'beneficiaries.recover' BEFORE 'documents.view_metadata';--> statement-breakpoint
CREATE TABLE "beneficiary_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"shared_device" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_handle" text;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_name_enc" "bytea";--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_words_hash" text;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_locked_by" uuid;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_unlock_hash" text;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "web_unlock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beneficiary_sessions" ADD CONSTRAINT "beneficiary_sessions_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beneficiary_sessions_beneficiary_idx" ON "beneficiary_sessions" USING btree ("beneficiary_id");--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_web_locked_by_volunteers_id_fk" FOREIGN KEY ("web_locked_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_web_handle_unique" UNIQUE("web_handle");--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_web_words_hash_unique" UNIQUE("web_words_hash");--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_web_unlock_hash_unique" UNIQUE("web_unlock_hash");