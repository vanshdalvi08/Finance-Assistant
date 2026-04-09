DROP INDEX IF EXISTS "project_budgets_project_unique";--> statement-breakpoint
ALTER TABLE "project_budgets" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "project_budgets" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "projects" AS p SET "tenant_id" = COALESCE(u."tenant_id", '00000000-0000-0000-0000-000000000101') FROM "users" AS u WHERE p."created_by_id" = u."id" AND p."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "project_tasks" AS pt SET "tenant_id" = COALESCE(p."tenant_id", '00000000-0000-0000-0000-000000000101') FROM "projects" AS p WHERE pt."project_id" = p."id" AND pt."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "project_budgets" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "projects" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "project_tasks" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "project_budgets" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_tasks" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_budgets_tenant_index" ON "project_budgets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_tenant_project_unique" ON "project_budgets" USING btree ("tenant_id","project");--> statement-breakpoint
CREATE INDEX "project_tasks_tenant_index" ON "project_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "projects_tenant_index" ON "projects" USING btree ("tenant_id");
