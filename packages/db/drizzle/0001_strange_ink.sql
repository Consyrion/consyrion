CREATE TYPE "public"."approval_action" AS ENUM('approve', 'reject', 'request_more_debate', 'request_changes', 'select_alternative');--> statement-breakpoint
CREATE TYPE "public"."consensus_status" AS ENUM('consensus', 'partial', 'no_consensus');--> statement-breakpoint
CREATE TYPE "public"."council_phase" AS ENUM('independent_thinking', 'open_council', 'twelve_minds_council', 'minority_review', 'consensus_round', 'final_verdict', 'execution_council');--> statement-breakpoint
CREATE TYPE "public"."decision_mode" AS ENUM('independent_expert', 'adversarial_review', 'consensus');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."debate_message_kind" AS ENUM('comparison', 'question', 'answer', 'critique', 'rebuttal', 'preference', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."objection_status" AS ENUM('open', 'refuted', 'resolved', 'accepted', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('original', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."risk_category" AS ENUM('security', 'functional', 'performance', 'cost', 'maintainability', 'other');--> statement-breakpoint
CREATE TYPE "public"."council_session_status" AS ENUM('queued', 'running', 'cancel_requested', 'cancelled', 'failed', 'awaiting_approval', 'approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."usage_outcome" AS ENUM('ok', 'error', 'refusal', 'invalid_output', 'max_tokens');--> statement-breakpoint
CREATE TYPE "public"."verdict_outcome" AS ENUM('recommended', 'no_qualifying_solution', 'tie', 'insufficient_evidence');--> statement-breakpoint
CREATE TABLE "consensus_result" (
	"session_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" "consensus_status" NOT NULL,
	"agreements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disagreements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outstanding_risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hybrid_proposal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "council_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"provider" "ai_provider_id" NOT NULL,
	"model_id" text NOT NULL,
	"credential_id" text,
	"position" integer NOT NULL,
	"status" "participant_status" DEFAULT 'active' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "council_role_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"participant_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "council_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"brief_id" text NOT NULL,
	"mode" "decision_mode" NOT NULL,
	"policy" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"status" "council_session_status" DEFAULT 'queued' NOT NULL,
	"current_phase" "council_phase",
	"token_budget" integer NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"debate_rounds_run" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"phase" "council_phase" NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"participant_id" text NOT NULL,
	"role" text,
	"kind" "debate_message_kind" NOT NULL,
	"target_proposal_id" text,
	"parent_id" text,
	"category" "risk_category",
	"severity" "severity",
	"body" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_score" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"evaluator_participant_id" text NOT NULL,
	"criterion" text NOT NULL,
	"score" integer NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "final_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"superseded_at" timestamp with time zone,
	"outcome" "verdict_outcome" NOT NULL,
	"recommended_proposal_id" text,
	"recommended_revision_id" text,
	"matrix" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"action" "approval_action" NOT NULL,
	"selected_proposal_id" text,
	"comment" text DEFAULT '' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "minority_objection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"source_message_id" text,
	"proposal_id" text NOT NULL,
	"raised_by_participant_id" text NOT NULL,
	"category" "risk_category" NOT NULL,
	"severity" "severity" NOT NULL,
	"claim" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"response" text,
	"status" "objection_status" DEFAULT 'open' NOT NULL,
	"resolution_reason" text,
	"reviewed_by_participant_id" text,
	"blocking" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minority_review" (
	"session_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"favored_proposal_id" text,
	"majority_model_count" integer DEFAULT 0 NOT NULL,
	"independent_model_count" integer DEFAULT 0 NOT NULL,
	"reevaluation_triggered" boolean DEFAULT false NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"author_participant_id" text NOT NULL,
	"kind" "proposal_kind" DEFAULT 'original' NOT NULL,
	"label" text,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"version" integer NOT NULL,
	"phase" "council_phase" NOT NULL,
	"content" jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kept_position" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text,
	"participant_id" text,
	"phase" "council_phase",
	"provider" "ai_provider_id" NOT NULL,
	"model_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" "usage_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"evaluator_participant_id" text NOT NULL,
	"ranking" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"phase" "council_phase" NOT NULL,
	"status" "stage_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"input_hash" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "consensus_result" ADD CONSTRAINT "consensus_result_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_result" ADD CONSTRAINT "consensus_result_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_result" ADD CONSTRAINT "consensus_result_hybrid_proposal_id_proposal_id_fk" FOREIGN KEY ("hybrid_proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_participant" ADD CONSTRAINT "council_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_participant" ADD CONSTRAINT "council_participant_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_participant" ADD CONSTRAINT "council_participant_credential_id_ai_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ai_provider_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_role_assignment" ADD CONSTRAINT "council_role_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_role_assignment" ADD CONSTRAINT "council_role_assignment_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_role_assignment" ADD CONSTRAINT "council_role_assignment_participant_id_council_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_brief_id_project_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."project_brief"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_message" ADD CONSTRAINT "debate_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_message" ADD CONSTRAINT "debate_message_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_message" ADD CONSTRAINT "debate_message_participant_id_council_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_message" ADD CONSTRAINT "debate_message_target_proposal_id_proposal_id_fk" FOREIGN KEY ("target_proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_revision_id_proposal_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."proposal_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_evaluator_participant_id_council_participant_id_fk" FOREIGN KEY ("evaluator_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_decision" ADD CONSTRAINT "final_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_decision" ADD CONSTRAINT "final_decision_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_decision" ADD CONSTRAINT "final_decision_recommended_proposal_id_proposal_id_fk" FOREIGN KEY ("recommended_proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_decision" ADD CONSTRAINT "final_decision_recommended_revision_id_proposal_revision_id_fk" FOREIGN KEY ("recommended_revision_id") REFERENCES "public"."proposal_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_decision_id_final_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."final_decision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_selected_proposal_id_proposal_id_fk" FOREIGN KEY ("selected_proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_source_message_id_debate_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."debate_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_raised_by_participant_id_council_participant_id_fk" FOREIGN KEY ("raised_by_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_objection" ADD CONSTRAINT "minority_objection_reviewed_by_participant_id_council_participant_id_fk" FOREIGN KEY ("reviewed_by_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_review" ADD CONSTRAINT "minority_review_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_review" ADD CONSTRAINT "minority_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minority_review" ADD CONSTRAINT "minority_review_favored_proposal_id_proposal_id_fk" FOREIGN KEY ("favored_proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_author_participant_id_council_participant_id_fk" FOREIGN KEY ("author_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_revision" ADD CONSTRAINT "proposal_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_revision" ADD CONSTRAINT "proposal_revision_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_participant_id_council_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."council_participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_evaluator_participant_id_council_participant_id_fk" FOREIGN KEY ("evaluator_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage" ADD CONSTRAINT "workflow_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage" ADD CONSTRAINT "workflow_stage_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_session_position_uq" ON "council_participant" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "role_session_role_uq" ON "council_role_assignment" USING btree ("session_id","role");--> statement-breakpoint
CREATE INDEX "council_session_org_idx" ON "council_session" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "council_session_project_idx" ON "council_session" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "message_session_phase_idx" ON "debate_message" USING btree ("session_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "score_revision_evaluator_criterion_uq" ON "evaluation_score" USING btree ("revision_id","evaluator_participant_id","criterion");--> statement-breakpoint
CREATE INDEX "job_status_run_at_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "objection_session_idx" ON "minority_objection" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "proposal_session_idx" ON "proposal" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_proposal_version_uq" ON "proposal_revision" USING btree ("proposal_id","version");--> statement-breakpoint
CREATE INDEX "usage_org_created_idx" ON "usage_record" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_session_idx" ON "usage_record" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_session_evaluator_uq" ON "vote" USING btree ("session_id","evaluator_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_session_phase_uq" ON "workflow_stage" USING btree ("session_id","phase");