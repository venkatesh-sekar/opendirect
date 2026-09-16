CREATE TABLE `canvas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`slot_field` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_edges_project_id_idx` ON `canvas_edges` (`project_id`);--> statement-breakpoint
CREATE INDEX `canvas_edges_source_node_id_idx` ON `canvas_edges` (`source_node_id`);--> statement-breakpoint
CREATE INDEX `canvas_edges_target_node_id_idx` ON `canvas_edges` (`target_node_id`);--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`asset_id` text,
	`generation_id` text,
	`batch_id` text,
	`pick_asset_id` text,
	`text` text,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pick_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `canvas_nodes_project_id_idx` ON `canvas_nodes` (`project_id`);--> statement-breakpoint
CREATE INDEX `canvas_nodes_generation_id_idx` ON `canvas_nodes` (`generation_id`);--> statement-breakpoint
CREATE INDEX `canvas_nodes_batch_id_idx` ON `canvas_nodes` (`batch_id`);--> statement-breakpoint
ALTER TABLE `generations` ADD `batch_id` text;--> statement-breakpoint
CREATE INDEX `generations_batch_id_idx` ON `generations` (`batch_id`);