ALTER TABLE "salaries" DROP CONSTRAINT IF EXISTS "salaries_employee_id_users_id_fk";
ALTER TABLE "salaries" ALTER COLUMN "employee_id" DROP NOT NULL;
ALTER TABLE "salaries"
  ADD CONSTRAINT "salaries_employee_id_users_id_fk"
  FOREIGN KEY ("employee_id")
  REFERENCES "public"."users"("id")
  ON DELETE set null
  ON UPDATE no action;
