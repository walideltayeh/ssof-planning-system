CREATE TYPE "public"."app_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."arrivalStatus" AS ENUM('Pending', 'In Transit', 'Arrived', 'Delayed', 'Cleared', 'Partially Cleared');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('Core', 'NPI');--> statement-breakpoint
CREATE TYPE "public"."country" AS ENUM('Lebanon', 'Syria', 'Libya');--> statement-breakpoint
CREATE TYPE "public"."packagingType" AS ENUM('Old', 'New');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"displayName" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"role" "app_role" DEFAULT 'viewer' NOT NULL,
	"countries" text NOT NULL,
	"isOwner" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "arrival_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"week1" numeric(12, 2) DEFAULT '0',
	"week2" numeric(12, 2) DEFAULT '0',
	"week3" numeric(12, 2) DEFAULT '0',
	"week4" numeric(12, 2) DEFAULT '0',
	"arrivalOffsetWeeks" integer DEFAULT 0,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_trail" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" "country" DEFAULT 'Lebanon',
	"username" varchar(100) NOT NULL,
	"action" varchar(50) NOT NULL,
	"sheet" varchar(100),
	"skuName" varchar(255),
	"periodLabel" varchar(50),
	"field" varchar(100),
	"oldValue" text,
	"newValue" text,
	"details" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"country" "country" NOT NULL,
	"clearedQty" numeric(12, 2) NOT NULL,
	"clearedDate" date NOT NULL,
	"pendingClearDate" date,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"value" numeric(12, 2) DEFAULT '0',
	"targetWeek" varchar(10) DEFAULT 'week1',
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ims_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"value" numeric(12, 2) DEFAULT '0',
	"isActual" boolean DEFAULT false,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" "country" DEFAULT 'Lebanon' NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"label" varchar(20) NOT NULL,
	"sortOrder" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planning_fg_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"openingStock" numeric(12, 2) DEFAULT '0',
	"adjustments" numeric(12, 2) DEFAULT '0',
	"invoiced" numeric(12, 2) DEFAULT '0',
	"arrivals" numeric(12, 2) DEFAULT '0',
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revised_forecast_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"value" numeric(12, 2) DEFAULT '0',
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"skuId" integer NOT NULL,
	"periodId" integer NOT NULL,
	"week1" numeric(12, 2) DEFAULT '0',
	"week2" numeric(12, 2) DEFAULT '0',
	"week3" numeric(12, 2) DEFAULT '0',
	"week4" numeric(12, 2) DEFAULT '0',
	"arrivalOffsetValue" integer DEFAULT 0,
	"arrivalOffsetUnit" varchar(10) DEFAULT 'days',
	"arrivalStatus" "arrivalStatus" DEFAULT 'Pending',
	"clearedQty" numeric(12, 2),
	"clearedDate" date,
	"pendingClearDate" date,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" "country" DEFAULT 'Lebanon' NOT NULL,
	"name" varchar(255) NOT NULL,
	"weight" varchar(10) NOT NULL,
	"category" "category" DEFAULT 'Core' NOT NULL,
	"packagingType" "packagingType" DEFAULT 'New',
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isExcludedFromTotal" boolean DEFAULT false,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssof_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" "country" DEFAULT 'Lebanon' NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"savedBy" varchar(100) NOT NULL,
	"snapshotData" json NOT NULL,
	"changesSummary" json,
	"docUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"country" "country" DEFAULT 'Lebanon',
	"uploadType" varchar(50) NOT NULL,
	"fileName" varchar(255),
	"recordsProcessed" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending',
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"displayName" varchar(255) NOT NULL,
	"country" varchar(50) NOT NULL,
	"currentPage" varchar(255) DEFAULT '/' NOT NULL,
	"lastSeen" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "version_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"versionId" integer NOT NULL,
	"username" varchar(100) NOT NULL,
	"comment" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
