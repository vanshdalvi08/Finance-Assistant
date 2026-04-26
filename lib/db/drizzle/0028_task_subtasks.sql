ALTER TABLE "project_tasks"
ADD COLUMN IF NOT EXISTS "sub_tasks" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "timesheet_lines"
ADD COLUMN IF NOT EXISTS "sub_task" text;
