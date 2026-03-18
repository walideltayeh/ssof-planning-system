CREATE TABLE `revised_forecast_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`value` decimal(12,2) DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `revised_forecast_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `skus` DROP INDEX `skus_name_unique`;--> statement-breakpoint
ALTER TABLE `arrival_data` ADD `arrivalOffsetWeeks` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `audit_trail` ADD `country` enum('Lebanon','Syria','Libya') DEFAULT 'Lebanon';--> statement-breakpoint
ALTER TABLE `periods` ADD `country` enum('Lebanon','Syria','Libya') DEFAULT 'Lebanon' NOT NULL;--> statement-breakpoint
ALTER TABLE `skus` ADD `country` enum('Lebanon','Syria','Libya') DEFAULT 'Lebanon' NOT NULL;--> statement-breakpoint
ALTER TABLE `skus` ADD `packagingType` enum('Old','New') DEFAULT 'New';--> statement-breakpoint
ALTER TABLE `ssof_versions` ADD `country` enum('Lebanon','Syria','Libya') DEFAULT 'Lebanon' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_history` ADD `country` enum('Lebanon','Syria','Libya') DEFAULT 'Lebanon';