CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`masked_id` text,
	`currency` text DEFAULT 'ETB' NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`balance_at` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_type_mask` ON `accounts` (`user_id`,`type`,`masked_id`);--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`data` text,
	`earned_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievements_user_key_period` ON `achievements` (`user_id`,`key`,`period`);--> statement-breakpoint
CREATE TABLE `action_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`undone_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_log_user_time` ON `action_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`alert80_period` text,
	`alert100_period` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_user_category` ON `budgets` (`user_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`name_am` text,
	`icon` text,
	`color` text,
	`is_spending` integer DEFAULT true NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_key` ON `categories` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`due_at` integer,
	`origin_transaction_id` integer,
	`settled_transaction_id` integer,
	`settled_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`origin_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`settled_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`target` integer NOT NULL,
	`saved` integer DEFAULT 0 NOT NULL,
	`deadline` integer,
	`achieved_at` integer,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`display_name` text NOT NULL,
	`masked_id` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `people_user_name` ON `people` (`user_id`,`display_name`);--> statement-breakpoint
CREATE TABLE `raw_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`channel` text NOT NULL,
	`sender` text NOT NULL,
	`body_enc` blob NOT NULL,
	`dedupe_key` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text NOT NULL,
	`template` text,
	`confidence` real,
	`parse_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_messages_user_dedupe` ON `raw_messages` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `raw_messages_user_status` ON `raw_messages` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	`match_key` text NOT NULL,
	`category_id` integer,
	`avg_amount` integer NOT NULL,
	`interval_days` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`next_expected_at` integer NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`field` text NOT NULL,
	`pattern` text NOT NULL,
	`category_id` integer NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rules_user_field_pattern` ON `rules` (`user_id`,`field`,`pattern`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`raw_message_id` integer,
	`channel` text NOT NULL,
	`source` text NOT NULL,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`fee` integer DEFAULT 0 NOT NULL,
	`vat` integer DEFAULT 0 NOT NULL,
	`other_charges` integer DEFAULT 0 NOT NULL,
	`balance_after` integer,
	`counterparty_name` text,
	`counterparty_masked_id` text,
	`person_id` integer,
	`reference` text,
	`receipt_url` text,
	`occurred_at` integer NOT NULL,
	`occurred_at_estimated` integer DEFAULT false NOT NULL,
	`category_id` integer,
	`note` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`transfer_group_id` text,
	`reconciliation` text DEFAULT 'unknown' NOT NULL,
	`reconciliation_delta` integer,
	`confidence` real DEFAULT 1 NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raw_message_id`) REFERENCES `raw_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_source_ref` ON `transactions` (`user_id`,`source`,`reference`);--> statement-breakpoint
CREATE INDEX `transactions_user_time` ON `transactions` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_account_time` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_user_category` ON `transactions` (`user_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_transfer_group` ON `transactions` (`transfer_group_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`first_name` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`calendar_mode` text DEFAULT 'gregorian' NOT NULL,
	`timezone` text DEFAULT 'Africa/Addis_Ababa' NOT NULL,
	`digest_time` text DEFAULT '21:00' NOT NULL,
	`digest_enabled` integer DEFAULT true NOT NULL,
	`large_tx_threshold` integer DEFAULT 500000 NOT NULL,
	`low_balance_threshold` integer DEFAULT 50000 NOT NULL,
	`ingest_secret_hash` text,
	`ingest_secret_prev_hash` text,
	`ingest_secret_rotated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);