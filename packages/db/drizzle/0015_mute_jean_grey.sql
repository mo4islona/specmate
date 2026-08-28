ALTER TABLE "tasks" ALTER COLUMN "model_bindings" SET DEFAULT '{"planner":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"researcher":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"spec_writer":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"implementer":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"verifier":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"validator":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"reviewer":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"summarizer":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"answerer":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"},"retro":{"provider":"claude-code","model":"claude-opus-5","reasoningEffort":"high"}}'::jsonb;--> statement-breakpoint
-- REQ-303/AC-351: a binding is complete or it is not a binding, so a task stored
-- before the provider was part of one gets a concrete provider rather than being
-- completed differently by every reader. Keyed on the model, which belongs to
-- exactly one provider; every model storable before this change was a Claude one.
UPDATE "tasks" SET "model_bindings" = (
	SELECT jsonb_object_agg(
		"role",
		"binding" || jsonb_build_object(
			'provider',
			CASE WHEN "binding"->>'model' LIKE 'gpt-%' THEN 'codex' ELSE 'claude-code' END
		)
	)
	FROM jsonb_each("model_bindings") AS "each"("role", "binding")
	WHERE jsonb_typeof("binding") = 'object'
)
WHERE EXISTS (
	SELECT 1 FROM jsonb_each("model_bindings") AS "each"("role", "binding")
	WHERE jsonb_typeof("binding") = 'object' AND NOT ("binding" ? 'provider')
);--> statement-breakpoint
-- REQ-313/AC-352: the same, for the stored defaults every later task resolves from.
UPDATE "app_settings" SET "value" = (
	SELECT jsonb_object_agg(
		"role",
		"binding" || jsonb_build_object(
			'provider',
			CASE WHEN "binding"->>'model' LIKE 'gpt-%' THEN 'codex' ELSE 'claude-code' END
		)
	)
	FROM jsonb_each("value") AS "each"("role", "binding")
	WHERE jsonb_typeof("binding") = 'object'
)
WHERE "key" = 'model-defaults' AND EXISTS (
	SELECT 1 FROM jsonb_each("value") AS "each"("role", "binding")
	WHERE jsonb_typeof("binding") = 'object' AND NOT ("binding" ? 'provider')
);
