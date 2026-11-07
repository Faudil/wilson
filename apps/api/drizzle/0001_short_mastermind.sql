CREATE TYPE "public"."knowledge_kind" AS ENUM('procedure', 'contact', 'guide');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source" AS ENUM('service_public', 'annuaire', 'association', 'watizat');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'knowledge.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'knowledge.manage';--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" "knowledge_source" NOT NULL,
	"external_id" text NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"department" text,
	"text" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', coalesce(title, '')), 'A') || setweight(to_tsvector('french', coalesce(text, '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" "knowledge_source" PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"last_sync_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_source_ext_idx" ON "knowledge_chunks" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tsv_idx" ON "knowledge_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_dept_idx" ON "knowledge_chunks" USING btree ("department");