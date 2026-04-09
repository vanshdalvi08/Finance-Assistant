CREATE TYPE "public"."platform_event_category" AS ENUM('request', 'auth', 'database', 'upload', 'tenant', 'system');--> statement-breakpoint
CREATE TYPE "public"."platform_event_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
ALTER TYPE "public"."audit_actor_role" ADD VALUE 'platform_super_admin' BEFORE 'system';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'platform_super_admin';--> statement-breakpoint
CREATE TABLE "platform_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"severity" "platform_event_severity" DEFAULT 'info' NOT NULL,
	"category" "platform_event_category" DEFAULT 'system' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"path" text,
	"method" text,
	"status_code" integer,
	"duration_ms" integer,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_events" ADD CONSTRAINT "platform_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_events_tenant_index" ON "platform_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "platform_events_severity_index" ON "platform_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "platform_events_category_index" ON "platform_events" USING btree ("category");--> statement-breakpoint
CREATE INDEX "platform_events_created_index" ON "platform_events" USING btree ("created_at");
