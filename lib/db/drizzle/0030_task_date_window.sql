ALTER TABLE "project_tasks"
ADD COLUMN IF NOT EXISTS "start_date" text,
ADD COLUMN IF NOT EXISTS "end_date" text;

DO $$
BEGIN
  ALTER TABLE "project_tasks"
  ADD CONSTRAINT "project_tasks_window_pair_check"
  CHECK (("start_date" IS NULL AND "end_date" IS NULL) OR ("start_date" IS NOT NULL AND "end_date" IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "project_tasks"
  ADD CONSTRAINT "project_tasks_window_order_check"
  CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
