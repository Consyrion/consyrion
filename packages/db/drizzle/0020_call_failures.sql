ALTER TYPE "public"."debate_message_kind" ADD VALUE 'role_failed';--> statement-breakpoint
ALTER TABLE "minority_objection" ADD COLUMN "undefended_reason" text;--> statement-breakpoint
ALTER TABLE "usage_record" ADD COLUMN "error_kind" text;--> statement-breakpoint
ALTER TABLE "usage_record" ADD COLUMN "http_status" integer;