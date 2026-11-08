CREATE TABLE "assistant_check" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" text NOT NULL,
	"model" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_check" ADD CONSTRAINT "assistant_check_chat_id_assistant_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."assistant_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_check" ADD CONSTRAINT "assistant_check_message_id_assistant_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."assistant_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_check_chat_idx" ON "assistant_check" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_check_message_model_uq" ON "assistant_check" USING btree ("message_id","model");