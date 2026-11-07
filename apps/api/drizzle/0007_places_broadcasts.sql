CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'sending', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."place_kind" AS ENUM('shelter', 'food', 'shower', 'clothes', 'health', 'other');--> statement-breakpoint
CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('queued', 'awaiting_reply', 'sent', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."chat_intent" ADD VALUE 'places';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'places.view' BEFORE 'notes.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'places.manage' BEFORE 'notes.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'broadcasts.view' BEFORE 'notes.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'broadcasts.create' BEFORE 'notes.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'broadcasts.approve' BEFORE 'notes.view';--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"broadcast_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"status" "broadcast_recipient_status" DEFAULT 'queued' NOT NULL,
	"via_template" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "broadcast_recipients_broadcast_id_beneficiary_id_pk" PRIMARY KEY("broadcast_id","beneficiary_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_fr" text NOT NULL,
	"languages" "language"[],
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimate" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "place_kind" NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"details" text,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"opens_at" text,
	"closes_at" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "announcements_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_approved_by_volunteers_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_updated_by_volunteers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_recipients_beneficiary_idx" ON "broadcast_recipients" USING btree ("beneficiary_id","status");--> statement-breakpoint
CREATE INDEX "broadcasts_created_idx" ON "broadcasts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "places_active_idx" ON "places" USING btree ("removed_at","starts_on");