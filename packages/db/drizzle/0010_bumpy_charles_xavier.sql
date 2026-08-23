ALTER TYPE "public"."agent_role" ADD VALUE 'validator' BEFORE 'reviewer';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'specify' BEFORE 'research';--> statement-breakpoint
ALTER TYPE "public"."task_status" ADD VALUE 'validate' BEFORE 'verify';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "model_bindings" SET DEFAULT '{"planner":{"model":"claude-opus-5","reasoningEffort":"high"},"researcher":{"model":"claude-opus-5","reasoningEffort":"high"},"spec_writer":{"model":"claude-opus-5","reasoningEffort":"high"},"implementer":{"model":"claude-opus-5","reasoningEffort":"high"},"verifier":{"model":"claude-opus-5","reasoningEffort":"high"},"validator":{"model":"claude-opus-5","reasoningEffort":"high"},"reviewer":{"model":"claude-opus-5","reasoningEffort":"high"},"summarizer":{"model":"claude-opus-5","reasoningEffort":"high"},"answerer":{"model":"claude-opus-5","reasoningEffort":"high"},"retro":{"model":"claude-opus-5","reasoningEffort":"high"}}'::jsonb;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "provider_session_id" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "cold_start_reason" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "caps_override" jsonb DEFAULT '{}'::jsonb NOT NULL;