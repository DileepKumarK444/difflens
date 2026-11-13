CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`login` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
