CREATE TYPE "public"."tenant_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "max_hours" real;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_index" ON "tenants" USING btree ("status");--> statement-breakpoint
INSERT INTO "tenants" ("id", "name", "slug", "status", "created_at", "updated_at") VALUES ('00000000-0000-0000-0000-000000000101', 'Yojak', 'yojak', 'active', now(), now()) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "company_settings" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_tenant_unique" ON "company_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_tenant_index" ON "users" USING btree ("tenant_id");
