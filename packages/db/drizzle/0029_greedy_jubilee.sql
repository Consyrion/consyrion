CREATE TABLE "platform_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"secret" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hosted pricing (owner decision 05.11.26): Free = 2 councils a month without GitHub build; Pro = 4.99 € incl. VAT, unlimited.
UPDATE "plan_definition" SET "name" = 'Free', "price_label" = 'Free', "entitlements" = '{"maxMembers":1,"maxProjects":3,"maxSessionsPerMonth":2,"maxParticipantsPerSession":3,"executionCouncil":false,"github":false,"maxExecutionsPerMonth":0,"maxSandboxMinutesPerMonth":0}'::jsonb, "updated_at" = now() WHERE "key" = 'starter';--> statement-breakpoint
UPDATE "plan_definition" SET "name" = 'Pro', "price_label" = '4.99 € / month', "entitlements" = '{"maxMembers":3,"maxProjects":1000000,"maxSessionsPerMonth":1000000,"maxParticipantsPerSession":6,"executionCouncil":true,"github":true,"maxExecutionsPerMonth":1000000,"maxSandboxMinutesPerMonth":0}'::jsonb, "updated_at" = now() WHERE "key" = 'pro';
