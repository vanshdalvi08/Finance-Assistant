DO $$ BEGIN
  CREATE TYPE "purchase_order_status" AS ENUM ('active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD COLUMN "status" "purchase_order_status" NOT NULL DEFAULT 'active';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_orders_status_index" ON "purchase_orders" ("status");
