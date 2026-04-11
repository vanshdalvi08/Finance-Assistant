DO $$ BEGIN
  ALTER TABLE "funds" ADD CONSTRAINT "funds_amount_positive_check" CHECK ("amount" > 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive_check" CHECK ("amount" > 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salaries" ADD CONSTRAINT "salaries_amount_positive_check" CHECK ("amount" > 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salaries" ADD CONSTRAINT "salaries_hours_nonnegative_check" CHECK ("hours" IS NULL OR "hours" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "salaries" ADD CONSTRAINT "salaries_rate_nonnegative_check" CHECK ("rate" IS NULL OR "rate" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_max_hours_nonnegative_check" CHECK ("max_hours" IS NULL OR "max_hours" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_amount_nonnegative_check" CHECK ("total_amount" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_used_amount_nonnegative_check" CHECK ("used_amount" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_remaining_amount_nonnegative_check" CHECK ("remaining_amount" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_used_not_over_total_check" CHECK ("used_amount" <= "total_amount") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_remaining_not_over_total_check" CHECK ("remaining_amount" <= "total_amount") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_hours_nonnegative_check"
    CHECK ("mon" >= 0 AND "tue" >= 0 AND "wed" >= 0 AND "thu" >= 0 AND "fri" >= 0 AND "sat" >= 0 AND "sun" >= 0) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
