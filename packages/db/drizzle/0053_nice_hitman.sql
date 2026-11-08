CREATE TABLE "deletion_tombstone" (
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_tombstone_kind_entity_id_pk" PRIMARY KEY("kind","entity_id")
);
