ALTER TYPE "public"."source" ADD VALUE 'seo';--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'direct';--> statement-breakpoint
DROP INDEX "web_sessions_uniq";--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_source" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_medium" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_medium" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_campaign" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "web_sessions" ALTER COLUMN "utm_campaign" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD COLUMN "traffic_source" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_uniq" ON "web_sessions" USING btree ("date","utm_source","utm_medium","utm_campaign","traffic_source");