ALTER TABLE "project_document" ADD COLUMN "role" text DEFAULT 'source' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_document" ADD COLUMN "origin" jsonb;