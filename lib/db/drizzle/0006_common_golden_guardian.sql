CREATE TYPE "public"."pre_approval_status" AS ENUM('draft', 'submitted', 'changes_requested', 'approved');--> statement-breakpoint
ALTER TYPE "public"."audit_actor_role" ADD VALUE 'client' BEFORE 'system';--> statement-breakpoint
ALTER TYPE "public"."audit_entity_type" ADD VALUE 'pre-approval';--> statement-breakpoint
ALTER TYPE "public"."audit_entity_type" ADD VALUE 'pre-approval-comment';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'client';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pre_approval_created' BEFORE 'fund_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pre_approval_submitted' BEFORE 'fund_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pre_approval_approved' BEFORE 'fund_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pre_approval_changes_requested' BEFORE 'fund_created';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pre_approval_commented' BEFORE 'fund_created';--> statement-breakpoint
CREATE TABLE "pre_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"project" text NOT NULL,
	"client_id" uuid NOT NULL,
	"client_name_snapshot" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "pre_approval_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pre_approvals" ADD CONSTRAINT "pre_approvals_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_approvals" ADD CONSTRAINT "pre_approvals_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pre_approvals_client_index" ON "pre_approvals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "pre_approvals_status_index" ON "pre_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pre_approvals_project_index" ON "pre_approvals" USING btree ("project");--> statement-breakpoint
CREATE INDEX "pre_approvals_created_by_index" ON "pre_approvals" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "pre_approvals_updated_index" ON "pre_approvals" USING btree ("updated_at");