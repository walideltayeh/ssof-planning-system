CREATE TABLE `user_presence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(100) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`country` varchar(50) NOT NULL,
	`currentPage` varchar(255) NOT NULL DEFAULT '/',
	`lastSeen` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_presence_id` PRIMARY KEY(`id`)
);
