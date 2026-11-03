CREATE TABLE "github_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_artifact" ADD COLUMN "mode" text DEFAULT '100644' NOT NULL;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "repository_full_name" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "base_branch" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "base_commit_sha" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "snapshot_skipped" jsonb;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "pull_request_number" integer;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "pull_request_url" text;--> statement-breakpoint
ALTER TABLE "development_plan" ADD COLUMN "pull_request_commit_sha" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "github_integration_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "repository_full_name" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "repository_default_branch" text;--> statement-breakpoint
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_org_installation_uq" ON "github_integration" USING btree ("organization_id","installation_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_github_integration_id_github_integration_id_fk" FOREIGN KEY ("github_integration_id") REFERENCES "public"."github_integration"("id") ON DELETE set null ON UPDATE no action;