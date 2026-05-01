ALTER TABLE "project_tasks"
ADD COLUMN IF NOT EXISTS "hour_limit_scope" text NOT NULL DEFAULT 'overall';
