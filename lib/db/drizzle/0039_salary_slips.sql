ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joining_date" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bank_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bank_account_number" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "uan" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pf_number" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "esi_number" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_slips" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "salary_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "account_id" text,
  "pay_period" text NOT NULL,
  "payment_date" timestamp with time zone NOT NULL,
  "gross_amount" integer NOT NULL,
  "deduction_amount" integer DEFAULT 0 NOT NULL,
  "net_amount" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "emailed_at" timestamp with time zone,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "salary_slips_gross_nonnegative_check" CHECK ("salary_slips"."gross_amount" >= 0),
  CONSTRAINT "salary_slips_deductions_nonnegative_check" CHECK ("salary_slips"."deduction_amount" >= 0),
  CONSTRAINT "salary_slips_net_positive_check" CHECK ("salary_slips"."net_amount" > 0),
  CONSTRAINT "salary_slips_net_reconciled_check" CHECK ("salary_slips"."net_amount" = "salary_slips"."gross_amount" - "salary_slips"."deduction_amount")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_slips_tenant_index" ON "salary_slips" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_slips_employee_index" ON "salary_slips" USING btree ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_slips_payment_date_index" ON "salary_slips" USING btree ("payment_date");
