CREATE TABLE "assistant_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_usage_owner_idx" ON "assistant_usage" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_usage_org_idx" ON "assistant_usage" USING btree ("organization_id","kind","created_at");--> statement-breakpoint
-- Before the unique index: should two second opinions point to the same answer (only possible by a race before this
-- release), all but the earliest are unlinked (review_of = NULL) – no message is deleted.
UPDATE "assistant_message" SET "review_of" = NULL
WHERE "review_of" IS NOT NULL AND "id" NOT IN (
  SELECT DISTINCT ON ("review_of") "id" FROM "assistant_message" WHERE "review_of" IS NOT NULL ORDER BY "review_of", "created_at", "id"
);--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_message_review_of_uq" ON "assistant_message" USING btree ("review_of");--> statement-breakpoint
-- Backfill: answers and second opinions stored so far count toward the limits after the switch to the ledger.
INSERT INTO "assistant_usage" ("id", "organization_id", "user_id", "kind", "input_tokens", "output_tokens", "created_at")
SELECT 'asu_' || m."id", c."organization_id", c."user_id",
       CASE WHEN m."review_of" IS NULL THEN 'answer' ELSE 'second_opinion' END,
       COALESCE(m."input_tokens", 0), COALESCE(m."output_tokens", 0), m."created_at"
FROM "assistant_message" m JOIN "assistant_chat" c ON c."id" = m."chat_id"
WHERE m."role" = 'assistant' AND m."input_tokens" IS NOT NULL;
