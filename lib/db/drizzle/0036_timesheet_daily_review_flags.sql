ALTER TABLE "timesheets"
  ADD COLUMN "daily_review_holidays" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "daily_review_locks" jsonb DEFAULT '{}'::jsonb NOT NULL;
