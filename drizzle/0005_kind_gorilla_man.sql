CREATE TABLE `ssof_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`savedBy` varchar(100) NOT NULL,
	`snapshotData` json NOT NULL,
	`changesSummary` json,
	`docUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ssof_versions_id` PRIMARY KEY(`id`)
);
