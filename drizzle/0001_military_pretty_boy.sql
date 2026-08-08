CREATE TABLE "lead_touches" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"channel" varchar(32),
	"phone_norm" varchar(16),
	"phone_raw" varchar(64),
	"utm_source" varchar(256),
	"utm_medium" varchar(256),
	"utm_campaign" varchar(256),
	"channel_name" varchar(256),
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lead_touches_external_uniq" ON "lead_touches" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "lead_touches_phone_idx" ON "lead_touches" USING btree ("phone_norm");--> statement-breakpoint
CREATE INDEX "lead_touches_created_idx" ON "lead_touches" USING btree ("created_at");