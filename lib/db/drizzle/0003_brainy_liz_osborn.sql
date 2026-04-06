CREATE TYPE "public"."notification_delivery_channel" AS ENUM('in_app', 'email', 'both');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('employee_onboarded', 'employee_updated', 'employee_deactivated', 'timesheet_submitted', 'timesheet_approved', 'timesheet_reverted', 'expense_submitted', 'expense_approved', 'expense_rejected', 'salary_paid', 'project_created', 'project_task_added', 'purchase_order_created', 'purchase_order_task_added', 'purchase_order_task_paid', 'fund_created');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"actor_role" "audit_actor_role" NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivery_channel" "notification_delivery_channel" DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_index" ON "notifications" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_read_index" ON "notifications" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_created_index" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_type_index" ON "notifications" USING btree ("type");