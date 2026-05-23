DO $$ BEGIN
 CREATE TYPE "public"."financial_account_type" AS ENUM('operational', 'personal', 'mixed_use', 'reserve', 'cash');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."financial_account_category" AS ENUM('bank', 'cash', 'wallet', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_type" "financial_account_type" DEFAULT 'operational' NOT NULL,
	"category" "financial_account_category" DEFAULT 'bank' NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"include_in_operational_reporting" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_opening_balance_nonnegative_check" CHECK ("financial_accounts"."opening_balance" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "salaries" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "funds" ADD CONSTRAINT "funds_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salaries" ADD CONSTRAINT "salaries_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_tenant_index" ON "financial_accounts" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_name_index" ON "financial_accounts" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_active_index" ON "financial_accounts" USING btree ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_accounts_account_type_index" ON "financial_accounts" USING btree ("account_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funds_account_index" ON "funds" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_account_index" ON "expenses" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salaries_account_index" ON "salaries" USING btree ("account_id");
