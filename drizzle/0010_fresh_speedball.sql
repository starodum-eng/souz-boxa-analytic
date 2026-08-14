CREATE TABLE "sales_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"ext_id" varchar(200) NOT NULL,
	"client_id" varchar(128),
	"client_name" varchar(256),
	"pay_date" timestamp with time zone,
	"accrual_date" timestamp with time zone,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"method" varchar(64),
	"kind" varchar(64),
	"name" varchar(512),
	"category" varchar(256),
	"manager" varchar(256),
	"raw" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ledger_ext_uniq" ON "sales_ledger" USING btree ("ext_id");--> statement-breakpoint
CREATE INDEX "sales_ledger_paydate_idx" ON "sales_ledger" USING btree ("pay_date");--> statement-breakpoint
CREATE INDEX "sales_ledger_client_idx" ON "sales_ledger" USING btree ("client_id");