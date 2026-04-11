DO $$
BEGIN
  CREATE TYPE "public"."idempotency_request_status" AS ENUM('processing', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" "public"."idempotency_request_status" DEFAULT 'processing' NOT NULL,
  "response_entity_id" text,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "idempotency_keys_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_tenant_scope_key_unique"
  ON "idempotency_keys" USING btree ("tenant_id", "scope", "key_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idempotency_keys_tenant_index"
  ON "idempotency_keys" USING btree ("tenant_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idempotency_keys_scope_status_index"
  ON "idempotency_keys" USING btree ("scope", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idempotency_keys_response_entity_index"
  ON "idempotency_keys" USING btree ("response_entity_id");
