ALTER TYPE "public"."conversation_status" ADD VALUE 'with_volunteer' BEFORE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."volunteer_role" ADD VALUE 'responder' BEFORE 'volunteer';--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "chat_assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "pending_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "signup_note" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_chat_assignee_id_volunteers_id_fk" FOREIGN KEY ("chat_assignee_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_approved_by_volunteers_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;