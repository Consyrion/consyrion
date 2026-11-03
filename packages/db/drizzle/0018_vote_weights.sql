ALTER TABLE "council_participant" ADD COLUMN "vote_weight" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "council_participant" ADD COLUMN "vote_weight_suggestion" jsonb;