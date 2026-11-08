CREATE TYPE "public"."role_profile_visibility" AS ENUM('private', 'team');--> statement-breakpoint
CREATE TABLE "role_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"visibility" "role_profile_visibility" DEFAULT 'private' NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_profile_version" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "council_session" ADD COLUMN "role_profiles" jsonb;--> statement-breakpoint
ALTER TABLE "role_profile" ADD CONSTRAINT "role_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile" ADD CONSTRAINT "role_profile_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_version" ADD CONSTRAINT "role_profile_version_profile_id_role_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."role_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_version" ADD CONSTRAINT "role_profile_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_profile_version" ADD CONSTRAINT "role_profile_version_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_profile_org_idx" ON "role_profile" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "role_profile_owner_idx" ON "role_profile" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_profile_version_uq" ON "role_profile_version" USING btree ("profile_id","version");