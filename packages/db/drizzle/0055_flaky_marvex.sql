CREATE TABLE "human_intervention" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_intervention_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"intervention_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"participant_id" text,
	"model_id" text NOT NULL,
	"body" text NOT NULL,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_record" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "human_intervention" ADD CONSTRAINT "human_intervention_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_intervention" ADD CONSTRAINT "human_intervention_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_intervention" ADD CONSTRAINT "human_intervention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_intervention_answer" ADD CONSTRAINT "human_intervention_answer_intervention_id_human_intervention_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."human_intervention"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_intervention_answer" ADD CONSTRAINT "human_intervention_answer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_intervention_answer" ADD CONSTRAINT "human_intervention_answer_participant_id_council_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."council_participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_intervention_session_idx" ON "human_intervention" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "human_intervention_answer_idx" ON "human_intervention_answer" USING btree ("intervention_id","created_at");