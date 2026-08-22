CREATE TYPE "public"."plan_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "caps" SET DEFAULT '{"max_spec_iterations":3,"max_impl_iterations":3,"max_kickoff_regenerations":2,"repeated_finding_threshold":2,"max_plan_depth":1,"max_prerequisite_tasks":2}'::jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "origin_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_size" "plan_size";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_origin_task_id_tasks_id_fk" FOREIGN KEY ("origin_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Caps are read back from jsonb without a schema parse, so a row written before
-- this migration would answer `undefined` to the depth-cap check — the one value
-- that must never be undefined, since it is what closes the split recursion.
UPDATE "tasks" SET "caps" = "caps" || '{"max_plan_depth":1,"max_prerequisite_tasks":2}'::jsonb;
