CREATE TABLE "model_strength_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "model_strength_sync_ok_fetched_idx" ON "model_strength_sync" USING btree ("ok","fetched_at");