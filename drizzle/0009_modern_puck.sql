CREATE TABLE "client_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ext_id" varchar(160) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"client_id" varchar(128),
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"pay_date" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_payments_uniq" ON "client_payments" USING btree ("ext_id");--> statement-breakpoint
CREATE INDEX "client_payments_client_idx" ON "client_payments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_payments_paydate_idx" ON "client_payments" USING btree ("pay_date");