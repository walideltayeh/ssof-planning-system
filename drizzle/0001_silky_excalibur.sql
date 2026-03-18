CREATE TABLE `arrival_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`week1` decimal(12,2) DEFAULT '0',
	`week2` decimal(12,2) DEFAULT '0',
	`week3` decimal(12,2) DEFAULT '0',
	`week4` decimal(12,2) DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `arrival_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `forecast_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`value` decimal(12,2) DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forecast_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ims_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`value` decimal(12,2) DEFAULT '0',
	`isActual` boolean DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ims_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `periods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`label` varchar(20) NOT NULL,
	`sortOrder` int NOT NULL,
	CONSTRAINT `periods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `planning_fg_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`openingStock` decimal(12,2) DEFAULT '0',
	`adjustments` decimal(12,2) DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `planning_fg_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipment_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`week1` decimal(12,2) DEFAULT '0',
	`week2` decimal(12,2) DEFAULT '0',
	`week3` decimal(12,2) DEFAULT '0',
	`week4` decimal(12,2) DEFAULT '0',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shipment_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `skus` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`weight` varchar(10) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isExcludedFromTotal` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skus_id` PRIMARY KEY(`id`),
	CONSTRAINT `skus_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `upload_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`uploadType` varchar(50) NOT NULL,
	`fileName` varchar(255),
	`recordsProcessed` int DEFAULT 0,
	`status` varchar(20) DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `upload_history_id` PRIMARY KEY(`id`)
);
