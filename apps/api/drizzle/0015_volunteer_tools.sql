ALTER TYPE "public"."permission" ADD VALUE 'replies.manage' BEFORE 'usage.manage';--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD COLUMN "nickname_enc" "bytea";--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "password_reset_token_hash" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "password_reset_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Volunteers who already use the app do not get the first-day welcome.
UPDATE "volunteers" SET "welcomed_at" = now() WHERE "pending_approval" = false;--> statement-breakpoint
INSERT INTO "quick_replies" ("title", "text", "position") VALUES
  ('Bien reçu', 'Merci, j''ai bien reçu votre message. Je regarde et je vous réponds dès que possible.', 1),
  ('Photo de la lettre', 'Pouvez-vous m''envoyer une photo nette de la lettre, en entier, avec la date bien visible ?', 2),
  ('Apporter la lettre', 'Pouvez-vous apporter la lettre originale à la permanence ? Nous la regarderons avec vous.', 3),
  ('Venir à la permanence', 'Le mieux est d''en parler en personne. Pouvez-vous venir à la permanence de l''association ?', 4),
  ('Urgence', 'Si vous êtes en danger, appelez le 112. Pour dormir à l''abri ce soir, appelez le 115 (gratuit, 24 h/24).', 5);
