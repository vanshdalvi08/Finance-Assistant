ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "duration_days" integer;
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_duration_days_nonnegative_check" CHECK ("duration_days" IS NULL OR "duration_days" >= 0);
