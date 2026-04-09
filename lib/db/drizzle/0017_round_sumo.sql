ALTER TABLE "pre_approvals" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
UPDATE "pre_approvals" AS "pa"
SET "tenant_id" = COALESCE("users"."tenant_id", '00000000-0000-0000-0000-000000000101')
FROM "users"
WHERE "pa"."client_id" = "users"."id" AND "pa"."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pre_approvals"
SET "tenant_id" = '00000000-0000-0000-0000-000000000101'
WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "pre_approvals" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_approvals" ADD CONSTRAINT "pre_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pre_approvals_tenant_index" ON "pre_approvals" USING btree ("tenant_id");
