CREATE TYPE "public"."source" AS ENUM('yandex_direct', 'yandex_metrika', 'yandex_business', 'vk_ads', 'fitbase');--> statement-breakpoint
CREATE TABLE "ad_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"source" "source" NOT NULL,
	"campaign_id" varchar(128),
	"campaign_name" varchar(512),
	"utm_campaign" varchar(256),
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"fitbase_id" varchar(128) NOT NULL,
	"name" varchar(256),
	"phone" varchar(64),
	"utm_source" varchar(256),
	"utm_medium" varchar(256),
	"utm_campaign" varchar(256),
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"source" "source" NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cpl" numeric(14, 2),
	"cac" numeric(14, 2),
	"romi" numeric(8, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"fitbase_id" varchar(128) NOT NULL,
	"date" date NOT NULL,
	"client_fitbase_id" varchar(128),
	"product" varchar(512),
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"utm_source" varchar(256),
	"utm_medium" varchar(256),
	"utm_campaign" varchar(256),
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "source" NOT NULL,
	"status" varchar(32) NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"message" varchar(1024),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"utm_source" varchar(256),
	"utm_medium" varchar(256),
	"utm_campaign" varchar(256),
	"visits" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"bounces" integer DEFAULT 0 NOT NULL,
	"goal_reaches" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ad_spend_uniq" ON "ad_spend" USING btree ("date","source","campaign_id");--> statement-breakpoint
CREATE INDEX "ad_spend_date_idx" ON "ad_spend" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_fitbase_uniq" ON "clients" USING btree ("fitbase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_metrics_uniq" ON "daily_metrics" USING btree ("date","source");--> statement-breakpoint
CREATE INDEX "daily_metrics_date_idx" ON "daily_metrics" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_fitbase_uniq" ON "sales" USING btree ("fitbase_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_uniq" ON "web_sessions" USING btree ("date","utm_source","utm_medium","utm_campaign");--> statement-breakpoint
CREATE INDEX "web_sessions_date_idx" ON "web_sessions" USING btree ("date");