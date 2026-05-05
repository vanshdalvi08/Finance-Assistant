ALTER TABLE "timesheets"
ADD COLUMN "daily_review_notes" jsonb NOT NULL DEFAULT '{}'::jsonb;
