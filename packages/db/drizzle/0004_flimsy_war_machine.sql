ALTER TABLE "decisions" ADD COLUMN "node_key" text;--> statement-breakpoint
UPDATE "decisions" SET "node_key" = COALESCE((SELECT "stages"."node_key" FROM "stages" WHERE "stages"."id" = "decisions"."stage_id"), '') WHERE "node_key" IS NULL;--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "node_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "blocking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
WITH "ranked_open" AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "task_id", "node_key", "key" ORDER BY "created_at" DESC, "id" DESC
  ) AS "rn"
  FROM "decisions"
  WHERE "status" = 'open'
)
UPDATE "decisions" SET "status" = 'dismissed', "answered_by" = 'migration:0004_flimsy_war_machine', "answered_at" = now()
WHERE "id" IN (SELECT "id" FROM "ranked_open" WHERE "rn" > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_open_node_key_idx" ON "decisions" USING btree ("task_id","node_key","key") WHERE "decisions"."status" = 'open';