ALTER TABLE "pre_approvals" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pre_approvals" ADD COLUMN "received_fund_id" text;--> statement-breakpoint
ALTER TABLE "pre_approvals" ADD CONSTRAINT "pre_approvals_received_fund_id_funds_id_fk" FOREIGN KEY ("received_fund_id") REFERENCES "public"."funds"("id") ON DELETE set null ON UPDATE no action;