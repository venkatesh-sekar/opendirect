CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`rel_path` text,
	`text` text,
	`mime_type` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`bytes` integer,
	`sha256` text,
	`thumbnail_rel_path` text,
	`label` text,
	`pinned` integer DEFAULT false NOT NULL,
	`generation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_project_id_idx` ON `assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `assets_generation_id_idx` ON `assets` (`generation_id`);--> statement-breakpoint
CREATE TABLE `container_assets` (
	`container_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`container_id`, `asset_id`),
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `container_assets_container_id_idx` ON `container_assets` (`container_id`);--> statement-breakpoint
CREATE INDEX `container_assets_asset_id_idx` ON `container_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `containers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `containers_project_id_idx` ON `containers` (`project_id`);--> statement-breakpoint
CREATE INDEX `containers_parent_id_idx` ON `containers` (`parent_id`);--> statement-breakpoint
CREATE TABLE `generation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`slot_field` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_inputs_generation_id_idx` ON `generation_inputs` (`generation_id`);--> statement-breakpoint
CREATE INDEX `generation_inputs_asset_id_idx` ON `generation_inputs` (`asset_id`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`container_id` text,
	`provider` text NOT NULL,
	`model_slug` text NOT NULL,
	`model_version` text,
	`kind` text NOT NULL,
	`prompt` text,
	`params_json` text NOT NULL,
	`request_json` text,
	`response_json` text,
	`status` text NOT NULL,
	`error` text,
	`provider_job_id` text,
	`estimated_cost_usd` real,
	`actual_cost_usd` real,
	`cost_confidence` text,
	`parent_generation_id` text,
	`branch_note` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generations_project_id_idx` ON `generations` (`project_id`);--> statement-breakpoint
CREATE INDEX `generations_container_id_idx` ON `generations` (`container_id`);--> statement-breakpoint
CREATE INDEX `generations_parent_generation_id_idx` ON `generations` (`parent_generation_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_polled_at` integer,
	`next_poll_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `generations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_state_idx` ON `jobs` (`state`);--> statement-breakpoint
CREATE INDEX `jobs_generation_id_idx` ON `jobs` (`generation_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
