ALTER TABLE "tasks" ADD COLUMN "change_layout" text;--> statement-breakpoint
-- REQ-1707/AC-1724: a task that has already been provisioned keeps the folder it
-- has, wherever the repository's profile stands now. Keyed on the task having left
-- `draft`, which is what provisioning follows; a draft has no worktree yet and so
-- picks up the rule on its first one.
UPDATE "tasks" SET "change_layout" = 'repository' WHERE "status" <> 'draft';
