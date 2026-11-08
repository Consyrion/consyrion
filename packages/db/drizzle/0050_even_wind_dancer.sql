CREATE TYPE "public"."development_plan_kind" AS ENUM('regular', 'prototype');--> statement-breakpoint
ALTER TYPE "public"."approval_action" ADD VALUE 'mark_favorite';--> statement-breakpoint
ALTER TYPE "public"."approval_action" ADD VALUE 'approve_prototype';--> statement-breakpoint
ALTER TYPE "public"."approval_action" ADD VALUE 'approve_after_measurement';--> statement-breakpoint
CREATE TABLE "measurement_result" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"plan_id" text,
	"method" text NOT NULL,
	"target" text NOT NULL,
	"measured" text NOT NULL,
	"met" boolean NOT NULL,
	"evidence" text NOT NULL,
	"recorded_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "kind" "development_plan_kind" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_decision_id_final_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."final_decision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_plan_id_development_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."development_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_result" ADD CONSTRAINT "measurement_result_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measurement_result_session_idx" ON "measurement_result" USING btree ("session_id","proposal_id","requirement_id");