CREATE TABLE `version_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`versionId` int NOT NULL,
	`username` varchar(100) NOT NULL,
	`comment` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `version_comments_id` PRIMARY KEY(`id`)
);
