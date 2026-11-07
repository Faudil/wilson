CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('attestation_demande_asile', 'recepisse', 'titre_de_sejour', 'autorisation_provisoire_sejour', 'domiciliation', 'passport', 'identity_other', 'health_insurance', 'caf_attestation', 'convocation', 'letter', 'other');--> statement-breakpoint
CREATE TYPE "public"."expiry_source" AS ENUM('detected', 'entered_by_user', 'entered_by_volunteer');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('fr', 'en', 'ar', 'fa', 'ps', 'ur', 'uk', 'ti', 'so', 'am');--> statement-breakpoint
CREATE TYPE "public"."letter_status" AS ENUM('received', 'analyzing', 'pending_review', 'approved', 'sent', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."letter_type" AS ENUM('prefecture_residence_permit', 'prefecture_removal_order', 'ofpra_convocation', 'ofpra_decision', 'cnda', 'ofii', 'caf', 'cpam', 'france_travail', 'tax', 'housing', 'court', 'school', 'bank', 'other_official', 'not_official');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'image', 'document', 'template', 'interactive', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('letters.review', 'letters.view_photo', 'beneficiaries.view', 'beneficiaries.edit', 'documents.view_metadata', 'documents.view_file', 'documents.edit', 'sandbox.use', 'volunteers.manage', 'audit.view');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('d30', 'd7');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sent', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."volunteer_role" AS ENUM('volunteer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."urgency" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_id_hash" text NOT NULL,
	"wa_id_enc" "bytea" NOT NULL,
	"wa_id_last2" text NOT NULL,
	"language" "language" DEFAULT 'fr' NOT NULL,
	"language_confirmed" boolean DEFAULT false NOT NULL,
	"conversation_state" jsonb DEFAULT '{"step":"choose_language"}'::jsonb NOT NULL,
	"wrapped_dek" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"purge_at" timestamp with time zone,
	CONSTRAINT "beneficiaries_wa_id_hash_unique" UNIQUE("wa_id_hash")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"type" "document_type" DEFAULT 'other' NOT NULL,
	"label_enc" "bytea",
	"expires_at" date,
	"expiry_source" "expiry_source",
	"detection" jsonb,
	"confirmed" boolean DEFAULT false NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"purge_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"volunteer_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"status" "letter_status" DEFAULT 'received' NOT NULL,
	"photo_key" text,
	"photo_mime" text,
	"analysis_enc" "bytea",
	"fr_edited" boolean DEFAULT false NOT NULL,
	"letter_type" "letter_type",
	"urgency" "urgency",
	"deadline" date,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"awaiting_opt_in" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"kind" "message_kind" NOT NULL,
	"wa_message_id" text,
	"body_enc" "bytea",
	"media_key" text,
	"status" "message_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer_permissions" (
	"volunteer_id" uuid NOT NULL,
	"permission" "permission" NOT NULL,
	"granted" boolean NOT NULL,
	CONSTRAINT "volunteer_permissions_volunteer_id_permission_pk" PRIMARY KEY("volunteer_id","permission")
);
--> statement-breakpoint
CREATE TABLE "volunteers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "volunteer_role" DEFAULT 'volunteer' NOT NULL,
	"ui_language" "language" DEFAULT 'fr' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "volunteers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_events" ADD CONSTRAINT "letter_events_letter_id_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_events" ADD CONSTRAINT "letter_events_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_reviewed_by_volunteers_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_permissions" ADD CONSTRAINT "volunteer_permissions_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_expiry_idx" ON "documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "letters_status_idx" ON "letters" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "messages_beneficiary_idx" ON "messages" USING btree ("beneficiary_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_doc_kind_active_idx" ON "reminders" USING btree ("document_id","kind") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","due_at");