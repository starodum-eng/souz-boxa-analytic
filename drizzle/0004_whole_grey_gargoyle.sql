CREATE TABLE "source_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"utm_source" varchar(256) NOT NULL,
	"label" varchar(256) NOT NULL,
	"is_paid" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_mappings_utm_source_unique" UNIQUE("utm_source")
);
--> statement-breakpoint
ALTER TABLE "daily_metrics" ALTER COLUMN "source" SET DATA TYPE varchar(256);