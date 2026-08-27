CREATE TABLE "channel_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" varchar(256) NOT NULL,
	"parent" varchar(256) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_groups_channel_unique" UNIQUE("channel")
);
--> statement-breakpoint
CREATE TABLE "manual_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" varchar(256) NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"note" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
