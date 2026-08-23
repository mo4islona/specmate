ALTER TABLE "tasks" ALTER COLUMN "base_branch" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "base_branch" DROP NOT NULL;