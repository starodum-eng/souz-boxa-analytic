CREATE TABLE "client_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"fitbase_id" varchar(128) NOT NULL,
	"client_id" varchar(128),
	"start_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_visits_uniq" ON "client_visits" USING btree ("fitbase_id");--> statement-breakpoint
CREATE INDEX "client_visits_start_idx" ON "client_visits" USING btree ("start_at");