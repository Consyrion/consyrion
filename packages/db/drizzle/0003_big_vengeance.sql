CREATE TYPE "public"."execution_status" AS ENUM('queued', 'planning', 'running', 'reviewing', 'completed', 'failed', 'cancel_requested', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."development_task_status" AS ENUM('pending', 'running', 'done', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."test_run_status" AS ENUM('passed', 'failed', 'error', 'timeout', 'not_run');--> statement-breakpoint
CREATE TABLE "agent_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"task_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"task_id" text,
	"path" text NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"content" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"reviewer_participant_id" text NOT NULL,
	"focus" text NOT NULL,
	"verdict" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"approval_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"planner_participant_id" text NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"plan" jsonb,
	"token_budget" integer NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"max_repair_attempts" integer DEFAULT 2 NOT NULL,
	"error" text,
	"created_by_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_participant_id" text NOT NULL,
	"status" "development_task_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"task_id" text,
	"kind" text NOT NULL,
	"command" text NOT NULL,
	"sandbox" text NOT NULL,
	"status" "test_run_status" NOT NULL,
	"exit_code" integer,
	"output" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_record" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_task_id_development_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution" ADD CONSTRAINT "agent_execution_participant_id_council_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."council_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_artifact" ADD CONSTRAINT "code_artifact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_artifact" ADD CONSTRAINT "code_artifact_plan_id_development_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."development_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_artifact" ADD CONSTRAINT "code_artifact_task_id_development_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_plan_id_development_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."development_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_reviewer_participant_id_council_participant_id_fk" FOREIGN KEY ("reviewer_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_approval_id_human_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."human_approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_planner_participant_id_council_participant_id_fk" FOREIGN KEY ("planner_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan" ADD CONSTRAINT "development_plan_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task" ADD CONSTRAINT "development_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task" ADD CONSTRAINT "development_task_plan_id_development_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."development_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_task" ADD CONSTRAINT "development_task_assigned_participant_id_council_participant_id_fk" FOREIGN KEY ("assigned_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_plan_id_development_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."development_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_run" ADD CONSTRAINT "test_run_task_id_development_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."development_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_plan_path_version_uq" ON "code_artifact" USING btree ("plan_id","path","version");--> statement-breakpoint
CREATE INDEX "plan_session_idx" ON "development_plan" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_plan_key_uq" ON "development_task" USING btree ("plan_id","key");