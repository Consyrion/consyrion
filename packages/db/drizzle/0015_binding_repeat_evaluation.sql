ALTER TYPE "public"."approval_action" ADD VALUE 'repeat_evaluation';--> statement-breakpoint
ALTER TABLE "vote" ADD COLUMN "rejected_proposal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;