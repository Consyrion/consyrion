CREATE TABLE "assistant_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text,
	"model_id" text,
	"reviewer_credential_id" text,
	"reviewer_model_id" text,
	"daily_token_limit" integer,
	"monthly_token_limit" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "review_of" text;--> statement-breakpoint
ALTER TABLE "assistant_preference" ADD CONSTRAINT "assistant_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_preference" ADD CONSTRAINT "assistant_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_preference" ADD CONSTRAINT "assistant_preference_credential_id_ai_provider_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ai_provider_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_preference" ADD CONSTRAINT "assistant_preference_reviewer_credential_id_ai_provider_credential_id_fk" FOREIGN KEY ("reviewer_credential_id") REFERENCES "public"."ai_provider_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_preference_owner_uq" ON "assistant_preference" USING btree ("organization_id","user_id");