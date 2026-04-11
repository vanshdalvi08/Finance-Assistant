DO $$ BEGIN
  ALTER TABLE "audit_trail" ADD COLUMN "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "audit_trail" ADD COLUMN "request_id" text;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "audit_trail" ADD COLUMN "details" jsonb;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "audit_trail_actor_user_index" ON "audit_trail" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_trail_request_index" ON "audit_trail" ("request_id");
