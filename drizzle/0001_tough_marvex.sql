CREATE TABLE "birr"."imports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "birr"."imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"format" text NOT NULL,
	"entries_enc" "bytea",
	"summary" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "birr"."imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "birr"."imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "birr"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imports_user_status" ON "birr"."imports" USING btree ("user_id","status");