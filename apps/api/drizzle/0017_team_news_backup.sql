CREATE TYPE "public"."backup_status" AS ENUM('open', 'covered', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'news.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'news.post';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'backup.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'backup.ask';--> statement-breakpoint
CREATE TABLE "backup_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"needed_on" date NOT NULL,
	"starts_at" text,
	"place" text,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"skills" "volunteer_skill"[] DEFAULT '{}' NOT NULL,
	"needed" integer DEFAULT 1 NOT NULL,
	"open_to_all" boolean DEFAULT false NOT NULL,
	"status" "backup_status" DEFAULT 'open' NOT NULL,
	"association_id" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "backup_offers" (
	"call_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_offers_call_id_volunteer_id_pk" PRIMARY KEY("call_id","volunteer_id")
);
--> statement-breakpoint
CREATE TABLE "news_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"association_id" uuid,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "news_reads" (
	"post_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_reads_post_id_volunteer_id_pk" PRIMARY KEY("post_id","volunteer_id")
);
--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "changelog_seen" text;--> statement-breakpoint
ALTER TABLE "backup_calls" ADD CONSTRAINT "backup_calls_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_calls" ADD CONSTRAINT "backup_calls_author_id_volunteers_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_calls" ADD CONSTRAINT "backup_calls_closed_by_volunteers_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_offers" ADD CONSTRAINT "backup_offers_call_id_backup_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."backup_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_offers" ADD CONSTRAINT "backup_offers_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_association_id_associations_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."associations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_author_id_volunteers_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_post_id_news_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."news_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_calls_open_idx" ON "backup_calls" USING btree ("status","needed_on");--> statement-breakpoint
CREATE INDEX "backup_offers_volunteer_idx" ON "backup_offers" USING btree ("volunteer_id");--> statement-breakpoint
CREATE INDEX "news_posts_active_idx" ON "news_posts" USING btree ("removed_at","created_at");--> statement-breakpoint
CREATE INDEX "news_reads_volunteer_idx" ON "news_reads" USING btree ("volunteer_id");