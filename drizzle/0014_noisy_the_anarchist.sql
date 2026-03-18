CREATE TABLE `clearance_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`skuId` int NOT NULL,
	`periodId` int NOT NULL,
	`country` enum('Lebanon','Syria','Libya') NOT NULL,
	`clearedQty` decimal(12,2) NOT NULL,
	`clearedDate` date NOT NULL,
	`pendingClearDate` date,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clearance_events_id` PRIMARY KEY(`id`)
);
