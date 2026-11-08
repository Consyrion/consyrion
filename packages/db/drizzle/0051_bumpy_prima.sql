CREATE TYPE "public"."plan_usage_kind" AS ENUM('session', 'execution', 'sandbox_ms');--> statement-breakpoint
CREATE TABLE "plan_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "plan_usage_kind" NOT NULL,
	"amount" integer NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_usage" ADD CONSTRAINT "plan_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_usage_ref_uq" ON "plan_usage" USING btree ("organization_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "plan_usage_month_idx" ON "plan_usage" USING btree ("organization_id","kind","created_at");--> statement-breakpoint
-- #201 backfill (best effort, idempotent): the current UTC month from the rows that still exist. Runs deleted before
-- this migration cannot be recovered; nothing is invented. ON CONFLICT keeps a re-run from booking twice.
INSERT INTO "plan_usage" ("id", "organization_id", "kind", "amount", "ref_id", "created_at")
SELECT 'plu_bf_' || s."id", s."organization_id", 'session', 1, s."id", s."created_at"
FROM "council_session" s JOIN "project" p ON p."id" = s."project_id"
WHERE s."created_at" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND p."is_demo" = false
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "plan_usage" ("id", "organization_id", "kind", "amount", "ref_id", "created_at")
SELECT 'plu_bf_' || d."id", d."organization_id", 'execution', 1, d."id", d."created_at"
FROM "development_plan" d
WHERE d."created_at" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "plan_usage" ("id", "organization_id", "kind", "amount", "ref_id", "created_at")
SELECT 'plu_bf_' || t."id", t."organization_id", 'sandbox_ms', t."duration_ms", t."id", t."created_at"
FROM "test_run" t
WHERE t."created_at" >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND t."status" <> 'not_run' AND t."duration_ms" > 0
ON CONFLICT DO NOTHING;
