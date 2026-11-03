CREATE TYPE "public"."delivery_kind" AS ENUM('telegram', 'confluence');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_target" AS ENUM('email', 'telegram', 'confluence');--> statement-breakpoint
CREATE TABLE "delivery_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "delivery_kind" NOT NULL,
	"label" text NOT NULL,
	"config" jsonb NOT NULL,
	"encrypted_secret" text NOT NULL,
	"key_version" integer NOT NULL,
	"secret_hint" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"target" "delivery_target" NOT NULL,
	"connection_id" text,
	"recipient" text NOT NULL,
	"status" "delivery_status" NOT NULL,
	"error" text,
	"external_url" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "delivery_default" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD CONSTRAINT "delivery_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD CONSTRAINT "delivery_connection_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_connection_id_delivery_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."delivery_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_log" ADD CONSTRAINT "delivery_log_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_connection_org_label_uq" ON "delivery_connection" USING btree ("organization_id","kind","label");--> statement-breakpoint
CREATE INDEX "delivery_log_session_idx" ON "delivery_log" USING btree ("session_id");