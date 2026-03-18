ALTER TABLE `shipment_data` ADD `arrivalOffsetValue` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `shipment_data` ADD `arrivalOffsetUnit` varchar(10) DEFAULT 'days';