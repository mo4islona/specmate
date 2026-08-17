CREATE TYPE "public"."conversation_action_kind" AS ENUM('answer_decision', 'dismiss_decision', 'approve_gate', 'redirect_gate', 'rework_gate', 'instruct_next_run', 'restart_stage');--> statement-breakpoint
CREATE TYPE "public"."conversation_action_status" AS ENUM('proposed', 'confirmed', 'applying', 'applied', 'conflict', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('owner', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_status" AS ENUM('completed', 'queued', 'responding', 'failed');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."stage_cleanup_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."feedback_kind" RENAME TO "feedback_kind_old";--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('redirect', 'decision_answer', 'spec_edit', 'rework', 'overrule', 'comment', 'conversation', 'intervention');--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "kind" TYPE "public"."feedback_kind" USING (CASE WHEN "kind"::text = 'question' THEN 'conversation' ELSE "kind"::text END)::"public"."feedback_kind";--> statement-breakpoint
DROP TYPE "public"."feedback_kind_old";--> statement-breakpoint
ALTER TYPE "public"."stage_status" ADD VALUE 'interrupted';--> statement-breakpoint
CREATE TABLE "conversation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" "conversation_action_kind" NOT NULL,
	"target" jsonb NOT NULL,
	"instruction" text,
	"expected_version" jsonb NOT NULL,
	"actor" text,
	"status" "conversation_action_status" DEFAULT 'proposed' NOT NULL,
	"outcome" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"reply_to_message_id" uuid,
	"role" "conversation_message_role" NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"status" "conversation_message_status" NOT NULL,
	"stage_id" uuid,
	"task_state" "task_status" NOT NULL,
	"context_commit" text,
	"provider" "provider",
	"telemetry" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"subject_kind" text,
	"subject_id" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"context_commit" text,
	"context_task_state" "task_status",
	"summary_md" text,
	"summary_through" integer DEFAULT 0 NOT NULL,
	"provider_session" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "consumed_by_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "accepted_commit" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "workspace_commit" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "interrupted_by" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "interruption_action_id" uuid;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "interruption_cleanup_status" "stage_cleanup_status";--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "interruption_failure" text;--> statement-breakpoint
ALTER TABLE "conversation_actions" ADD CONSTRAINT "conversation_actions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_actions" ADD CONSTRAINT "conversation_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_actions" ADD CONSTRAINT "conversation_actions_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_reply_to_message_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_consumed_by_stage_id_stages_id_fk" FOREIGN KEY ("consumed_by_stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_actions_conversation_idx" ON "conversation_actions" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_actions_idempotency_idx" ON "conversation_actions" USING btree ("task_id","idempotency_key") WHERE "conversation_actions"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_order_idx" ON "conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_reply_idx" ON "conversation_messages" USING btree ("reply_to_message_id") WHERE "conversation_messages"."reply_to_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_one_active_idx" ON "conversation_messages" USING btree ("conversation_id") WHERE "conversation_messages"."status" = 'responding';--> statement-breakpoint
CREATE INDEX "conversation_messages_queue_idx" ON "conversation_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "conversations_task_status_created_idx" ON "conversations" USING btree ("task_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_subject_idx" ON "conversations" USING btree ("task_id","subject_kind","subject_id") WHERE "conversations"."subject_kind" is not null and "conversations"."subject_id" is not null;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_interruption_action_id_conversation_actions_id_fk" FOREIGN KEY ("interruption_action_id") REFERENCES "public"."conversation_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_task_idempotency_idx" ON "feedback" USING btree ("task_id","idempotency_key") WHERE "feedback"."idempotency_key" is not null;
