ALTER TABLE "feedback" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "reply_seen_at" timestamp with time zone;