CREATE TABLE "client_contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"fitbase_id" varchar(128) NOT NULL,
	"client_id" varchar(128),
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"begin_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitbase_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"fitbase_id" varchar(128) NOT NULL,
	"client_id" varchar(128),
	"phone_norm" varchar(16),
	"utm_source" varchar(256),
	"utm_medium" varchar(256),
	"utm_campaign" varchar(256),
	"advertising_source" varchar(256),
	"funnel_step" varchar(256),
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_mappings" ALTER COLUMN "label" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "source_mappings" ADD COLUMN "ignored" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "client_contracts_uniq" ON "client_contracts" USING btree ("fitbase_id");--> statement-breakpoint
CREATE INDEX "client_contracts_client_idx" ON "client_contracts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fitbase_leads_uniq" ON "fitbase_leads" USING btree ("fitbase_id");--> statement-breakpoint
CREATE INDEX "fitbase_leads_client_idx" ON "fitbase_leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "fitbase_leads_created_idx" ON "fitbase_leads" USING btree ("created_at");