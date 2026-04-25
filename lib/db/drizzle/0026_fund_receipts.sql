ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "receipt_name" text;
ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "receipt_path" text;
