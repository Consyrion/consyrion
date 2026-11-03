ALTER TYPE "public"."execution_status" ADD VALUE 'awaiting_plan_approval' BEFORE 'running';--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "require_plan_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "plan_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "plan_approved_by_id" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "plan_feedback" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_plan_approved_by_id_user_id_fk" FOREIGN KEY ("plan_approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;