CREATE TYPE "public"."skill_report_reason" AS ENUM('misleading', 'injection', 'personal_data', 'impersonation', 'spam', 'copyright', 'other');--> statement-breakpoint
CREATE TYPE "public"."skill_report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."skill_review_status" AS ENUM('draft', 'scanning', 'pending_review', 'published', 'rejected', 'quarantined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "skill_moderation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer,
	"actor_user_id" text,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_publisher" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_publisher_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "skill_report" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"reporter_user_id" text NOT NULL,
	"reason" "skill_report_reason" NOT NULL,
	"note" text,
	"status" "skill_report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "public_version" integer;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "review_status" "skill_review_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "scan_result" jsonb;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "ai_review" jsonb;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "license_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "reviewed_by_id" text;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "skill_version" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_moderation_log" ADD CONSTRAINT "skill_moderation_log_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_moderation_log" ADD CONSTRAINT "skill_moderation_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_publisher" ADD CONSTRAINT "skill_publisher_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_report" ADD CONSTRAINT "skill_report_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_report" ADD CONSTRAINT "skill_report_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_report" ADD CONSTRAINT "skill_report_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_moderation_log_skill_idx" ON "skill_moderation_log" USING btree ("skill_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_report_reporter_uq" ON "skill_report" USING btree ("skill_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "skill_report_status_idx" ON "skill_report" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_owner_slug_uq" ON "skill" USING btree ("owner_user_id","slug");--> statement-breakpoint
CREATE INDEX "skill_public_idx" ON "skill" USING btree ("public_version");--> statement-breakpoint
CREATE INDEX "skill_version_review_idx" ON "skill_version" USING btree ("review_status");