ALTER TABLE "audit_trail" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "audit_trail" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_trail" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_trail_tenant_index" ON "audit_trail" USING btree ("tenant_id");
