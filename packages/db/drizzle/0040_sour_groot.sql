ALTER TABLE "assistant_chat" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "assistant_chat" ADD COLUMN "summary_until" timestamp with time zone;