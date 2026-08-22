CREATE TABLE "standing_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_url" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin_task_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "caps" SET DEFAULT '{"max_spec_iterations":3,"max_impl_iterations":3,"max_kickoff_regenerations":2,"repeated_finding_threshold":2,"max_plan_depth":1,"max_prerequisite_tasks":2,"max_questions_per_stage":3}'::jsonb;--> statement-breakpoint
ALTER TABLE "standing_decisions" ADD CONSTRAINT "standing_decisions_origin_task_id_tasks_id_fk" FOREIGN KEY ("origin_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standing_decisions_in_force_idx" ON "standing_decisions" USING btree ("repo_url","key") WHERE "standing_decisions"."revoked_at" is null;--> statement-breakpoint
-- Same reason as 0007: caps come back from jsonb without a schema parse, so a
-- row written before this migration would answer `undefined` to the question cap.
UPDATE "tasks" SET "caps" = "caps" || '{"max_questions_per_stage":3}'::jsonb;
