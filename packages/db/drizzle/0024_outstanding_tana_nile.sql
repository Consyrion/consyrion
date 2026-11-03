CREATE TABLE "evaluation_round" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"round" integer NOT NULL,
	"requirement_list_id" text NOT NULL,
	"requirement_ids" jsonb NOT NULL,
	"proposals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_check" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"round_id" text NOT NULL,
	"evaluator_participant_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"status" text NOT NULL,
	"all_parts_met" boolean,
	"evidence" text NOT NULL,
	"valid" boolean NOT NULL,
	"invalid_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD CONSTRAINT "evaluation_round_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD CONSTRAINT "evaluation_round_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_round" ADD CONSTRAINT "evaluation_round_requirement_list_id_requirement_list_id_fk" FOREIGN KEY ("requirement_list_id") REFERENCES "public"."requirement_list"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_check" ADD CONSTRAINT "requirement_check_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_check" ADD CONSTRAINT "requirement_check_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_check" ADD CONSTRAINT "requirement_check_round_id_evaluation_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."evaluation_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_check" ADD CONSTRAINT "requirement_check_evaluator_participant_id_council_participant_id_fk" FOREIGN KEY ("evaluator_participant_id") REFERENCES "public"."council_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_round_session_round_uq" ON "evaluation_round" USING btree ("session_id","round");--> statement-breakpoint
CREATE INDEX "requirement_check_round_idx" ON "requirement_check" USING btree ("round_id");