ALTER TABLE "salaries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "salaries" AS s SET "tenant_id" = u."tenant_id" FROM "users" AS u WHERE s."employee_id" = u."id" AND s."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "salaries" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "salaries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salaries_tenant_index" ON "salaries" USING btree ("tenant_id");
