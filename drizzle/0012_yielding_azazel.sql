CREATE TABLE "kpi_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" varchar(7) NOT NULL,
	"metric" varchar(32) NOT NULL,
	"target" numeric(14, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_uniq" ON "kpi_targets" USING btree ("month","metric");