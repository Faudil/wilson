CREATE TYPE "public"."chat_intent" AS ENUM('info', 'legal', 'urgent', 'human', 'letter', 'document', 'smalltalk', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "public"."chat_state" AS ENUM('received', 'draft', 'sent', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('bot', 'pending_review', 'needs_human', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('beneficiary', 'bot', 'volunteer', 'system');--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ru';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'es';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'pt';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'tr';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ku';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ckb';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'bn';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ta';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ka';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'hy';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'sq';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ro';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ht';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'wo';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ff';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'bm';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'ln';--> statement-breakpoint
ALTER TYPE "public"."language" ADD VALUE 'sw';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'conversations.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'conversations.reply';--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "chat_status" "conversation_status" DEFAULT 'bot' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "author" "message_author";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "chat_state" "chat_state";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "intent" "chat_intent";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "text_fr_enc" "bytea";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "volunteer_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;