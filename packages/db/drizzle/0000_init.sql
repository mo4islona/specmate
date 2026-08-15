CREATE TYPE "public"."artifact_kind" AS ENUM('proposal', 'spec', 'design', 'tasks', 'review', 'verification', 'summary', 'decision_log');--> statement-breakpoint
CREATE TYPE "public"."auth_state" AS ENUM('ok', 'expired', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('question', 'escalation', 'rework', 'approval');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('open', 'answered', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('redirect', 'decision_answer', 'spec_edit', 'rework', 'overrule');--> statement-breakpoint
CREATE TYPE "public"."harness_status" AS ENUM('unknown', 'adequate', 'partial', 'missing', 'waived');--> statement-breakpoint
CREATE TYPE "public"."loop_kind" AS ENUM('spec', 'impl');--> statement-breakpoint
CREATE TYPE "public"."pr_state" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('claude-code', 'codex', 'copilot');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('planner', 'researcher', 'spec_writer', 'implementer', 'verifier', 'reviewer', 'summarizer', 'retro');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_human');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'planning', 'kickoff_brief', 'human_kickoff_gate', 'research', 'spec_review', 'human_spec_gate', 'implement', 'verify', 'code_review', 'summarize', 'human_final_gate', 'publish', 'archived', 'waiting_human', 'paused', 'blocked', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('feature', 'bugfix');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('approve', 'revise', 'escalate');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"git_sha" text,
	"snapshot_md" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stage_id" uuid,
	"key" text NOT NULL,
	"kind" "decision_kind" NOT NULL,
	"prompt_md" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer_md" text,
	"answered_by" text,
	"status" "decision_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"task_id" uuid,
	"stage_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"stage_id" uuid,
	"role" "agent_role",
	"provider" "provider",
	"kind" "feedback_kind" NOT NULL,
	"text_md" text NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iterations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"loop" "loop_kind" NOT NULL,
	"round" integer NOT NULL,
	"reviewer_verdict" "review_verdict" NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"auth_state" "auth_state" DEFAULT 'unknown' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"url" text NOT NULL,
	"state" "pr_state" DEFAULT 'open' NOT NULL,
	"checks_state" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dag" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"repo_url" text NOT NULL,
	"ref" text DEFAULT 'main' NOT NULL,
	"path" text DEFAULT '.' NOT NULL,
	"inject_into" "agent_role"[] DEFAULT '{}'::agent_role[] NOT NULL,
	"current_sha" text,
	"synced_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"graph_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"role" "agent_role" NOT NULL,
	"provider" "provider" NOT NULL,
	"status" "stage_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"skill_sha" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "task_type" NOT NULL,
	"repo_url" text NOT NULL,
	"base_branch" text DEFAULT 'main' NOT NULL,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"resume_status" "task_status",
	"blocked_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"harness_status" "harness_status" DEFAULT 'unknown' NOT NULL,
	"budgets" jsonb DEFAULT '{"max_wall_clock_minutes":180,"max_cost_usd":20}'::jsonb NOT NULL,
	"caps" jsonb DEFAULT '{"max_spec_iterations":3,"max_impl_iterations":3,"max_kickoff_regenerations":2,"repeated_finding_threshold":2}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_graphs" ADD CONSTRAINT "run_graphs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_graph_id_run_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."run_graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_task_path_idx" ON "artifacts" USING btree ("task_id","path");--> statement-breakpoint
CREATE INDEX "decisions_open_idx" ON "decisions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "events_task_seq_idx" ON "events" USING btree ("task_id","seq");--> statement-breakpoint
CREATE INDEX "feedback_role_created_idx" ON "feedback" USING btree ("role","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "iterations_task_loop_round_idx" ON "iterations" USING btree ("task_id","loop","round");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_url_idx" ON "pull_requests" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "run_graphs_task_version_idx" ON "run_graphs" USING btree ("task_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_sources_name_idx" ON "skill_sources" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_graph_node_attempt_idx" ON "stages" USING btree ("graph_id","node_key","attempt");--> statement-breakpoint
CREATE INDEX "stages_task_status_idx" ON "stages" USING btree ("task_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_slug_idx" ON "tasks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");