CREATE TYPE "public"."audit_actor_role" AS ENUM('admin', 'employee', 'system');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_entity_type" AS ENUM('employee', 'expense', 'fund', 'salary', 'timesheet', 'timesheet-line', 'category', 'project', 'project-task', 'project-budget', 'purchase-order', 'purchase-order-task');--> statement-breakpoint
CREATE TYPE "public"."expense_group" AS ENUM('personal', 'office');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_task_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_task_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."salary_source" AS ENUM('manual', 'timesheet');--> statement-breakpoint
CREATE TYPE "public"."salary_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."user_pay_type" AS ENUM('monthly', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'employee');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "audit_trail" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" "audit_actor_role" NOT NULL,
	"action" text NOT NULL,
	"entity_type" "audit_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"group" "expense_group" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" uuid,
	"employee_name_snapshot" text,
	"project" text,
	"category" text NOT NULL,
	"group" "expense_group" NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"attachment_name" text,
	"reimbursable" boolean DEFAULT false NOT NULL,
	"status" "approval_status" DEFAULT 'approved' NOT NULL,
	"reviewer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"total_budget" integer DEFAULT 0 NOT NULL,
	"client" text,
	"note" text DEFAULT '' NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "project_task_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client" text,
	"note" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"used_amount" integer DEFAULT 0 NOT NULL,
	"remaining_amount" integer DEFAULT 0 NOT NULL,
	"vendor" text,
	"date" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salaries" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name_snapshot" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "salary_status" DEFAULT 'pending' NOT NULL,
	"source" "salary_source" DEFAULT 'manual' NOT NULL,
	"paid_at" timestamp with time zone,
	"week_start" timestamp with time zone,
	"hours" integer,
	"rate" integer,
	"timesheet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"timesheet_id" text NOT NULL,
	"project_budget_id" text,
	"project_id" text,
	"project_task_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"mon" integer DEFAULT 0 NOT NULL,
	"tue" integer DEFAULT 0 NOT NULL,
	"wed" integer DEFAULT 0 NOT NULL,
	"thu" integer DEFAULT 0 NOT NULL,
	"fri" integer DEFAULT 0 NOT NULL,
	"sat" integer DEFAULT 0 NOT NULL,
	"sun" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name_snapshot" text NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"status" "approval_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_notes" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"role" "user_role" NOT NULL,
	"employee_id" text,
	"position" text,
	"department" text,
	"salary" integer DEFAULT 0 NOT NULL,
	"pay_type" "user_pay_type" DEFAULT 'monthly' NOT NULL,
	"hourly_rate" integer DEFAULT 0 NOT NULL,
	"profile_photo_url" text,
	"hashed_password" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"jti_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_project_budget_id_project_budgets_id_fk" FOREIGN KEY ("project_budget_id") REFERENCES "public"."project_budgets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_lines" ADD CONSTRAINT "timesheet_lines_project_task_id_project_tasks_id_fk" FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_trail_actor_index" ON "audit_trail" USING btree ("actor_name");--> statement-breakpoint
CREATE INDEX "audit_trail_entity_index" ON "audit_trail" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_trail_created_index" ON "audit_trail" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_group_unique" ON "expense_categories" USING btree ("name","group");--> statement-breakpoint
CREATE INDEX "expense_categories_group_index" ON "expense_categories" USING btree ("group");--> statement-breakpoint
CREATE INDEX "expenses_employee_index" ON "expenses" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "expenses_status_index" ON "expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expenses_date_index" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "expenses_category_index" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "expenses_project_index" ON "expenses" USING btree ("project");--> statement-breakpoint
CREATE INDEX "funds_source_index" ON "funds" USING btree ("source");--> statement-breakpoint
CREATE INDEX "funds_date_index" ON "funds" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_project_unique" ON "project_budgets" USING btree ("project");--> statement-breakpoint
CREATE INDEX "project_budgets_project_index" ON "project_budgets" USING btree ("project");--> statement-breakpoint
CREATE INDEX "project_budgets_updated_index" ON "project_budgets" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "project_tasks_project_index" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_name_index" ON "project_tasks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "project_tasks_status_index" ON "project_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_tasks_sort_order_index" ON "project_tasks" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "project_tasks_created_by_index" ON "project_tasks" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "projects_name_index" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "projects_client_index" ON "projects" USING btree ("client");--> statement-breakpoint
CREATE INDEX "projects_status_index" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_created_by_index" ON "projects" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_title_index" ON "purchase_orders" USING btree ("title");--> statement-breakpoint
CREATE INDEX "purchase_orders_vendor_index" ON "purchase_orders" USING btree ("vendor");--> statement-breakpoint
CREATE INDEX "purchase_orders_date_index" ON "purchase_orders" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_orders_updated_index" ON "purchase_orders" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "salaries_employee_index" ON "salaries" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "salaries_status_index" ON "salaries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "salaries_date_index" ON "salaries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "salaries_paid_at_index" ON "salaries" USING btree ("paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "salaries_timesheet_unique" ON "salaries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_timesheet_index" ON "timesheet_lines" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_project_budget_index" ON "timesheet_lines" USING btree ("project_budget_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_project_index" ON "timesheet_lines" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_project_task_index" ON "timesheet_lines" USING btree ("project_task_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_sort_order_index" ON "timesheet_lines" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "timesheets_employee_index" ON "timesheets" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "timesheets_week_index" ON "timesheets" USING btree ("week_start");--> statement-breakpoint
CREATE INDEX "timesheets_status_index" ON "timesheets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheets_employee_week_unique" ON "timesheets" USING btree ("employee_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_id_unique" ON "users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "users_role_index" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_index" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refresh_sessions_user_index" ON "refresh_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_sessions_jti_hash_unique" ON "refresh_sessions" USING btree ("jti_hash");--> statement-breakpoint
CREATE INDEX "refresh_sessions_expires_index" ON "refresh_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_index" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_index" ON "password_reset_tokens" USING btree ("expires_at");