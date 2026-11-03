CREATE TABLE "requirement_list" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"brief_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_state" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"excluded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"no_hard_requirements" boolean DEFAULT false NOT NULL,
	"confirmed_by_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "council_session" ADD COLUMN "requirement_list_id" text;--> statement-breakpoint
ALTER TABLE "final_decision" ADD COLUMN "requirement_list_id" text;--> statement-breakpoint
ALTER TABLE "human_approval" ADD COLUMN "requirement_list_id" text;--> statement-breakpoint
ALTER TABLE "requirement_list" ADD CONSTRAINT "requirement_list_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_list" ADD CONSTRAINT "requirement_list_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_list" ADD CONSTRAINT "requirement_list_brief_id_project_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."project_brief"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_list" ADD CONSTRAINT "requirement_list_confirmed_by_id_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_list_version_uq" ON "requirement_list" USING btree ("project_id","version");--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_requirement_list_id_requirement_list_id_fk" FOREIGN KEY ("requirement_list_id") REFERENCES "public"."requirement_list"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_decision" ADD CONSTRAINT "final_decision_requirement_list_id_requirement_list_id_fk" FOREIGN KEY ("requirement_list_id") REFERENCES "public"."requirement_list"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_approval" ADD CONSTRAINT "human_approval_requirement_list_id_requirement_list_id_fk" FOREIGN KEY ("requirement_list_id") REFERENCES "public"."requirement_list"("id") ON DELETE no action ON UPDATE no action;