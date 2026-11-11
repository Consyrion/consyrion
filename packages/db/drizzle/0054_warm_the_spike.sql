CREATE TYPE "public"."hub_kind" AS ENUM('skill', 'role_profile');--> statement-breakpoint
ALTER TABLE "role_profile" ADD COLUMN "forked_from" jsonb;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "kind" "hub_kind" DEFAULT 'skill' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "skill_publisher" ADD COLUMN "display_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_kind_source_uq" ON "skill" USING btree ("kind","source_id");