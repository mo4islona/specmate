ALTER TABLE "decisions" ADD COLUMN "node_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "blocking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_node_key_idx" ON "decisions" USING btree ("task_id","node_key","key") WHERE "decisions"."status" = 'open';