CREATE TYPE "public"."help_kind" AS ENUM('accompaniment', 'form_session');--> statement-breakpoint
CREATE TYPE "public"."help_reminder_kind" AS ENUM('d1', 'h2');--> statement-breakpoint
CREATE TYPE "public"."help_status" AS ENUM('draft', 'open', 'accepted', 'done', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."help_topic" AS ENUM('prefecture', 'ofii', 'hospital', 'ofpra', 'other_place', 'caf', 'anef', 'ame', 'other_form');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'appointments.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'appointments.accept';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'appointments.slots';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'appointments.documents';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'appointments.manage';--> statement-breakpoint
CREATE TABLE "help_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "help_reminder_kind" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"kind" "help_kind" NOT NULL,
	"topic" "help_topic" NOT NULL,
	"status" "help_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"city_enc" "bytea",
	"meeting_point_enc" "bytea",
	"volunteer_id" uuid,
	"slot_id" uuid,
	"documents_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "help_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"place" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "help_reminders" ADD CONSTRAINT "help_reminders_request_id_help_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."help_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_slot_id_help_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."help_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_slots" ADD CONSTRAINT "help_slots_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "help_reminders_req_kind_active_idx" ON "help_reminders" USING btree ("request_id","kind") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "help_reminders_due_idx" ON "help_reminders" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "help_requests_status_idx" ON "help_requests" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "help_requests_beneficiary_idx" ON "help_requests" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "help_requests_volunteer_idx" ON "help_requests" USING btree ("volunteer_id","starts_at");--> statement-breakpoint
CREATE INDEX "help_slots_starts_idx" ON "help_slots" USING btree ("starts_at");