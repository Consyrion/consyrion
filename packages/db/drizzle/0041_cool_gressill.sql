ALTER TABLE "skill" ADD COLUMN "forked_from" jsonb;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "changelog" text;