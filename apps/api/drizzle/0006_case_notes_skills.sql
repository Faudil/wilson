CREATE TYPE "public"."task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."volunteer_skill" AS ENUM('interpreting', 'legal', 'asylum', 'social_rights', 'health', 'housing', 'forms', 'digital', 'driving', 'accompaniment');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'notes.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'notes.write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'notes.moderate';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'tasks.assign';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'skills.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'skills.edit_own';--> statement-breakpoint
CREATE TABLE "case_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"author_id" uuid,
	"body_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"created_by" uuid,
	"assignee_id" uuid,
	"text_enc" "bytea" NOT NULL,
	"due_on" date,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid
);
--> statement-breakpoint
CREATE TABLE "volunteer_skills" (
	"volunteer_id" uuid PRIMARY KEY NOT NULL,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"skills" "volunteer_skill"[] DEFAULT '{}' NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_author_id_volunteers_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tasks" ADD CONSTRAINT "case_tasks_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tasks" ADD CONSTRAINT "case_tasks_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tasks" ADD CONSTRAINT "case_tasks_assignee_id_volunteers_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tasks" ADD CONSTRAINT "case_tasks_done_by_volunteers_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_skills" ADD CONSTRAINT "volunteer_skills_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_notes_beneficiary_idx" ON "case_notes" USING btree ("beneficiary_id","created_at");--> statement-breakpoint
CREATE INDEX "case_tasks_beneficiary_idx" ON "case_tasks" USING btree ("beneficiary_id","created_at");--> statement-breakpoint
CREATE INDEX "case_tasks_assignee_idx" ON "case_tasks" USING btree ("assignee_id","status","due_on");