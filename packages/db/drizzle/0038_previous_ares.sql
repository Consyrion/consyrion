ALTER TABLE "organization" ADD COLUMN "demo_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;