ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "funds" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "funds" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funds_tenant_index" ON "funds" USING btree ("tenant_id");
