CREATE TYPE "public"."buddy_match_status" AS ENUM('proposed', 'declined', 'active', 'suspended', 'ended');--> statement-breakpoint
CREATE TYPE "public"."buddy_mode" AS ENUM('call', 'meet');--> statement-breakpoint
CREATE TYPE "public"."buddy_mode_pref" AS ENUM('call', 'meet', 'either');--> statement-breakpoint
CREATE TYPE "public"."buddy_party" AS ENUM('beneficiary', 'volunteer', 'coordinator');--> statement-breakpoint
CREATE TYPE "public"."buddy_request_status" AS ENUM('waiting', 'matched', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."buddy_session_status" AS ENUM('scheduled', 'cancelled', 'done');--> statement-breakpoint
CREATE TYPE "public"."buddy_window" AS ENUM('weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'buddies.be_buddy';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'buddies.manage';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'buddies.reports';--> statement-breakpoint
CREATE TABLE "buddy_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"status" "buddy_match_status" DEFAULT 'proposed' NOT NULL,
	"weekday" integer NOT NULL,
	"time" text NOT NULL,
	"mode" "buddy_mode" NOT NULL,
	"place" text,
	"contact_shared" boolean DEFAULT false NOT NULL,
	"proposed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" "buddy_party"
);
--> statement-breakpoint
CREATE TABLE "buddy_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"author" "buddy_party" NOT NULL,
	"body_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_profiles" (
	"volunteer_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modes" "buddy_mode"[] NOT NULL,
	"max_buddies" integer DEFAULT 1 NOT NULL,
	"meet_place" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"by" "buddy_party" NOT NULL,
	"text_enc" "bytea" NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" text,
	"note_enc" "bytea",
	"handled_by" uuid,
	"handled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buddy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"windows" "buddy_window"[] NOT NULL,
	"mode" "buddy_mode_pref" NOT NULL,
	"status" "buddy_request_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buddy_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" "buddy_session_status" DEFAULT 'scheduled' NOT NULL,
	"cancelled_by" "buddy_party",
	"reminded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_request_id_buddy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."buddy_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_matches" ADD CONSTRAINT "buddy_matches_proposed_by_volunteers_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_messages" ADD CONSTRAINT "buddy_messages_match_id_buddy_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."buddy_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_profiles" ADD CONSTRAINT "buddy_profiles_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_reports" ADD CONSTRAINT "buddy_reports_match_id_buddy_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."buddy_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_reports" ADD CONSTRAINT "buddy_reports_handled_by_volunteers_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_requests" ADD CONSTRAINT "buddy_requests_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buddy_sessions" ADD CONSTRAINT "buddy_sessions_match_id_buddy_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."buddy_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buddy_matches_volunteer_idx" ON "buddy_matches" USING btree ("volunteer_id","status");--> statement-breakpoint
CREATE INDEX "buddy_matches_beneficiary_idx" ON "buddy_matches" USING btree ("beneficiary_id","status");--> statement-breakpoint
CREATE INDEX "buddy_messages_match_idx" ON "buddy_messages" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE INDEX "buddy_reports_status_idx" ON "buddy_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "buddy_requests_status_idx" ON "buddy_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_requests_one_waiting_idx" ON "buddy_requests" USING btree ("beneficiary_id") WHERE status = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_sessions_match_start_idx" ON "buddy_sessions" USING btree ("match_id","starts_at");--> statement-breakpoint
CREATE INDEX "buddy_sessions_due_idx" ON "buddy_sessions" USING btree ("status","starts_at");