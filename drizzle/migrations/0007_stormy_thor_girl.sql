ALTER TYPE "public"."country" ADD VALUE 'KSA';--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "email" varchar(320);--> statement-breakpoint
ALTER TABLE "ims_data" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "countryRoles" text DEFAULT '{}' NOT NULL;