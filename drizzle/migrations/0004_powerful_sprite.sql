CREATE TABLE "competitor_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" varchar(50) DEFAULT 'Lebanon' NOT NULL,
	"brand_monthly" json,
	"flavor_yearly" json,
	"uploaded_by" varchar(100),
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
