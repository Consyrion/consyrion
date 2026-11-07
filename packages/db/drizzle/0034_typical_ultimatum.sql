CREATE TABLE "telegram_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"question" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_request" ADD CONSTRAINT "telegram_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_request" ADD CONSTRAINT "telegram_request_connection_id_delivery_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."delivery_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_request" ADD CONSTRAINT "telegram_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_request" ADD CONSTRAINT "telegram_request_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_request_status_idx" ON "telegram_request" USING btree ("status","updated_at");