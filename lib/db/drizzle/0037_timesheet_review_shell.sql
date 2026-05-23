ALTER TABLE "timesheets"
ADD COLUMN IF NOT EXISTS "review_shell" boolean NOT NULL DEFAULT false;
