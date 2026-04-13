DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean NOT NULL DEFAULT false;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "mfa_secret" text;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "mfa_enrolled_at" timestamp with time zone;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "mfa_updated_at" timestamp with time zone;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "mfa_trusted_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  "user_agent" text,
  "ip_address" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "mfa_trusted_devices_token_hash_unique" ON "mfa_trusted_devices" ("token_hash");
CREATE INDEX IF NOT EXISTS "mfa_trusted_devices_user_index" ON "mfa_trusted_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "mfa_trusted_devices_expires_index" ON "mfa_trusted_devices" ("expires_at");
