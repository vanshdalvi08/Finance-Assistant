ALTER TABLE "project_tasks"
ADD COLUMN IF NOT EXISTS "employee_hour_limits" jsonb NOT NULL DEFAULT '[]'::jsonb;
