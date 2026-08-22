CREATE TABLE "import_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" varchar(256),
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"range_from" date,
	"range_to" date,
	"rows" integer DEFAULT 0 NOT NULL,
	"sum_paid" numeric(14, 2) DEFAULT '0' NOT NULL
);
