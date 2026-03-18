CREATE TABLE `audit_trail` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(100) NOT NULL,
	`action` varchar(50) NOT NULL,
	`sheet` varchar(100),
	`skuName` varchar(255),
	`periodLabel` varchar(50),
	`field` varchar(100),
	`oldValue` text,
	`newValue` text,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_trail_id` PRIMARY KEY(`id`)
);
