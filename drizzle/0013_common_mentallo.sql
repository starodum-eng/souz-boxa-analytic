CREATE TABLE "smm_weekly" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"platform" varchar(16) NOT NULL,
	"posts" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"engagement" integer DEFAULT 0 NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" varchar(512),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "smm_weekly_uniq" ON "smm_weekly" USING btree ("week_start","platform");