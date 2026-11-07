ALTER TYPE "public"."permission" ADD VALUE 'usage.manage';--> statement-breakpoint
CREATE TABLE "llm_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_enc" "bytea" NOT NULL,
	"key_last4" text NOT NULL,
	"monthly_limit_cents" integer,
	"disabled_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "llm_budget" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"monthly_limit_cents" integer,
	"hard_stop" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"language" "language",
	"beneficiary_id" uuid,
	"api_key_id" uuid,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer
);
--> statement-breakpoint
ALTER TABLE "llm_api_keys" ADD CONSTRAINT "llm_api_keys_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_budget" ADD CONSTRAINT "llm_budget_updated_by_volunteers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_api_key_id_llm_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."llm_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_at_idx" ON "llm_usage" USING btree ("at");