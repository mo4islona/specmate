CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "model_bindings" jsonb DEFAULT '{"planner":{"model":"claude-opus-5","reasoningEffort":"high"},"researcher":{"model":"claude-opus-5","reasoningEffort":"high"},"spec_writer":{"model":"claude-opus-5","reasoningEffort":"high"},"implementer":{"model":"claude-opus-5","reasoningEffort":"high"},"verifier":{"model":"claude-opus-5","reasoningEffort":"high"},"reviewer":{"model":"claude-opus-5","reasoningEffort":"high"},"summarizer":{"model":"claude-opus-5","reasoningEffort":"high"},"answerer":{"model":"claude-opus-5","reasoningEffort":"high"},"retro":{"model":"claude-opus-5","reasoningEffort":"high"}}'::jsonb NOT NULL;
--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES (
	'model-defaults',
	'{"planner":{"model":"claude-opus-5","reasoningEffort":"high"},"researcher":{"model":"claude-opus-5","reasoningEffort":"high"},"spec_writer":{"model":"claude-opus-5","reasoningEffort":"high"},"implementer":{"model":"claude-opus-5","reasoningEffort":"high"},"verifier":{"model":"claude-opus-5","reasoningEffort":"high"},"reviewer":{"model":"claude-opus-5","reasoningEffort":"high"},"summarizer":{"model":"claude-opus-5","reasoningEffort":"high"},"answerer":{"model":"claude-opus-5","reasoningEffort":"high"},"retro":{"model":"claude-opus-5","reasoningEffort":"high"}}'::jsonb
) ON CONFLICT ("key") DO NOTHING;