ALTER TABLE "purchase_orders" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "purchase_orders" SET "tenant_id" = '00000000-0000-0000-0000-000000000101' WHERE "tenant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_index" ON "purchase_orders" USING btree ("tenant_id");
