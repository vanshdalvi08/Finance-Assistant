ALTER TABLE "salary_slips" ADD COLUMN "email_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_slips" ADD COLUMN "email_error" text;--> statement-breakpoint
ALTER TABLE "salary_slips" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;