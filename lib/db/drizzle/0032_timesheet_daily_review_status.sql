ALTER TABLE "timesheets"
ADD COLUMN "daily_review_status" jsonb NOT NULL DEFAULT '{}'::jsonb;
