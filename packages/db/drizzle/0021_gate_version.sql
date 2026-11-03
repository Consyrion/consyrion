ALTER TYPE "public"."verdict_outcome" ADD VALUE 'needs_verification';--> statement-breakpoint
ALTER TABLE "final_decision" ADD COLUMN "gate_version" integer;--> statement-breakpoint
-- Explicit legacy marking (#181, stage 1): every decision that exists now was computed by the feasibility gate of
-- production e33a3bb and is marked as gate version 1. No verdict, outcome or matrix is recomputed or changed.
UPDATE "final_decision" SET "gate_version" = 1 WHERE "gate_version" IS NULL;
