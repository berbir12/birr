CREATE SCHEMA "birr";
--> statement-breakpoint
CREATE TABLE "birr"."accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"masked_id" text,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"balance_at" bigint,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."achievements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."achievements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"key" text NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"data" jsonb,
	"earned_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."achievements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."action_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."action_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"undone_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."action_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."bot_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"pending" jsonb,
	"expires_at" bigint
);
--> statement-breakpoint
ALTER TABLE "birr"."bot_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."budgets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."budgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"alert80_period" text,
	"alert100_period" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_am" text,
	"icon" text,
	"color" text,
	"is_spending" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."debts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."debts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"direction" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"due_at" bigint,
	"origin_transaction_id" integer,
	"settled_transaction_id" integer,
	"settled_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."debts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."goals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."goals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"target" bigint NOT NULL,
	"saved" bigint DEFAULT 0 NOT NULL,
	"deadline" bigint,
	"achieved_at" bigint,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."people" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."people_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"masked_id" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."raw_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."raw_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"channel" text NOT NULL,
	"sender" text NOT NULL,
	"body_enc" "bytea" NOT NULL,
	"dedupe_key" text NOT NULL,
	"received_at" bigint NOT NULL,
	"status" text NOT NULL,
	"template" text,
	"confidence" double precision,
	"parse_error" text,
	"candidate" jsonb,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."raw_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."recurring_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."recurring_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"match_key" text NOT NULL,
	"category_id" integer,
	"avg_amount" bigint NOT NULL,
	"interval_days" integer NOT NULL,
	"last_seen_at" bigint NOT NULL,
	"next_expected_at" bigint NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."recurring_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"field" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."transaction_splits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."transaction_splits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "birr"."transaction_splits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"raw_message_id" integer,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"vat" bigint DEFAULT 0 NOT NULL,
	"other_charges" bigint DEFAULT 0 NOT NULL,
	"balance_after" bigint,
	"counterparty_name" text,
	"counterparty_masked_id" text,
	"person_id" integer,
	"reference" text,
	"receipt_url" text,
	"occurred_at" bigint NOT NULL,
	"occurred_at_estimated" boolean DEFAULT false NOT NULL,
	"category_id" integer,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transfer_group_id" text,
	"reconciliation" text DEFAULT 'unknown' NOT NULL,
	"reconciliation_delta" bigint,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"confirmed_at" bigint,
	"deleted_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "birr"."users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" bigint NOT NULL,
	"first_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"calendar_mode" text DEFAULT 'gregorian' NOT NULL,
	"timezone" text DEFAULT 'Africa/Addis_Ababa' NOT NULL,
	"digest_time" text DEFAULT '21:00' NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"large_tx_threshold" bigint DEFAULT 500000 NOT NULL,
	"low_balance_threshold" bigint DEFAULT 50000 NOT NULL,
	"ingest_secret_hash" text,
	"ingest_secret_prev_hash" text,
	"ingest_secret_rotated_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "birr"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "birr"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."action_log" ADD CONSTRAINT "action_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."bot_state" ADD CONSTRAINT "bot_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "birr"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."debts" ADD CONSTRAINT "debts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "birr"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."debts" ADD CONSTRAINT "debts_origin_transaction_id_transactions_id_fk" FOREIGN KEY ("origin_transaction_id") REFERENCES "birr"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."debts" ADD CONSTRAINT "debts_settled_transaction_id_transactions_id_fk" FOREIGN KEY ("settled_transaction_id") REFERENCES "birr"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."raw_messages" ADD CONSTRAINT "raw_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."recurring_items" ADD CONSTRAINT "recurring_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."recurring_items" ADD CONSTRAINT "recurring_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "birr"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."rules" ADD CONSTRAINT "rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."rules" ADD CONSTRAINT "rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "birr"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "birr"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "birr"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "birr"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transactions" ADD CONSTRAINT "transactions_raw_message_id_raw_messages_id_fk" FOREIGN KEY ("raw_message_id") REFERENCES "birr"."raw_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transactions" ADD CONSTRAINT "transactions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "birr"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birr"."transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "birr"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_type_mask" ON "birr"."accounts" USING btree ("user_id","type","masked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_user_key_period" ON "birr"."achievements" USING btree ("user_id","key","period");--> statement-breakpoint
CREATE INDEX "action_log_user_time" ON "birr"."action_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_category" ON "birr"."budgets" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_key" ON "birr"."categories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "people_user_name" ON "birr"."people" USING btree ("user_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_messages_user_dedupe" ON "birr"."raw_messages" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "raw_messages_user_status" ON "birr"."raw_messages" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_user_field_pattern" ON "birr"."rules" USING btree ("user_id","field","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_source_ref" ON "birr"."transactions" USING btree ("user_id","source","reference");--> statement-breakpoint
CREATE INDEX "transactions_user_time" ON "birr"."transactions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_account_time" ON "birr"."transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_user_category" ON "birr"."transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group" ON "birr"."transactions" USING btree ("transfer_group_id");