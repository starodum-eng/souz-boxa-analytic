CREATE TABLE "sync_state" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"last_updated_at" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
