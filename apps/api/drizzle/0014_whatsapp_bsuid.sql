ALTER TABLE "beneficiaries" ADD COLUMN "user_id_hash" text;--> statement-breakpoint
CREATE INDEX "beneficiaries_user_id_hash_idx" ON "beneficiaries" USING btree ("user_id_hash");