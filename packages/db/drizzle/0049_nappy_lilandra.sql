ALTER TABLE "evaluation_round" ADD COLUMN "kind" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD COLUMN "parent_round_id" text;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD COLUMN "items" jsonb;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD COLUMN "token_budget" integer;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD CONSTRAINT "evaluation_round_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;