ALTER TABLE "salaries" ADD COLUMN "days" integer;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_days_nonnegative_check" CHECK ("salaries"."days" IS NULL OR "salaries"."days" >= 0);
