ALTER TABLE "timesheet_lines"
ADD COLUMN "work_notes" jsonb NOT NULL DEFAULT '{}'::jsonb;
