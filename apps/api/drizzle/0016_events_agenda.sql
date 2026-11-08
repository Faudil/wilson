CREATE TYPE "public"."event_kind" AS ENUM('maraude', 'meeting', 'training', 'workshop', 'info_session', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_registration_status" AS ENUM('going', 'waitlist');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'events.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'events.join';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'events.create';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'events.manage';--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"volunteer_id" uuid,
	"beneficiary_id" uuid,
	"status" "event_registration_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"association_id" uuid,
	"kind" "event_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"place" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"volunteer_spots" integer,
	"public" boolean DEFAULT false NOT NULL,
	"public_spots" integer,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"skills" "volunteer_skill"[] DEFAULT '{}' NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_volunteers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_volunteer_idx" ON "event_registrations" USING btree ("event_id","volunteer_id") WHERE volunteer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_beneficiary_idx" ON "event_registrations" USING btree ("event_id","beneficiary_id") WHERE beneficiary_id is not null;--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "event_registrations_volunteer_list_idx" ON "event_registrations" USING btree ("volunteer_id");--> statement-breakpoint
CREATE INDEX "event_registrations_beneficiary_list_idx" ON "event_registrations" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "events_public_idx" ON "events" USING btree ("public","starts_at");