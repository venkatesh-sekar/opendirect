ALTER TABLE `containers` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `containers` ADD `description` text;--> statement-breakpoint
CREATE UNIQUE INDEX `containers_project_handle_unq` ON `containers` (`project_id`,`handle`);