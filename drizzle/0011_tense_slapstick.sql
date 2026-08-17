CREATE TABLE "oauth_tokens" (
	"provider" varchar(64) PRIMARY KEY NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"user_id" varchar(128),
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
