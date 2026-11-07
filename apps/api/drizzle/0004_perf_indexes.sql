CREATE INDEX "documents_beneficiary_idx" ON "documents" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "letter_events_letter_idx" ON "letter_events" USING btree ("letter_id","at");--> statement-breakpoint
CREATE INDEX "letters_beneficiary_idx" ON "letters" USING btree ("beneficiary_id","received_at");