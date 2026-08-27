CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized" text NOT NULL,
	"repo_url" text NOT NULL,
	"mirror_key" text NOT NULL,
	"default_branch" text,
	"spec_convention" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_normalized_idx" ON "repositories" USING btree ("normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_mirror_key_idx" ON "repositories" USING btree ("mirror_key");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_default_idx" ON "repositories" USING btree ("is_default") WHERE "repositories"."is_default";--> statement-breakpoint

-- The backfill needs to group the existing rows by repository identity, and that
-- identity is a TypeScript function. These transcribe `normalizeRemote` and
-- `mirrorKey` for the length of this migration and are dropped at the end of it:
-- after this runs, every value is written by the application, so there is nothing
-- left to drift out of step. `migrations.test.ts` runs the migration over the same
-- table of spellings the TypeScript functions are tested against.
CREATE FUNCTION mig_normalize_remote(url text) RETURNS text AS $$
	SELECT lower(
		regexp_replace(
			regexp_replace(
				regexp_replace(
					regexp_replace(
						regexp_replace(btrim(url, E' \t\n\r\f\v'), '/+$', ''),
					'\.git$', '', 'i'),
				'^[a-z][a-z0-9+.-]*://', '', 'i'),
			'^[^/@]+@', ''),
		':', '/')
	)
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
-- A settings value written before the driver's double-encoding was fixed is a jsonb
-- *string* holding the JSON rather than the object — the same unwrap `schema.ts`
-- does on read. Without it `jsonb_each` below fails the whole migration on a row
-- nobody has rewritten since.
CREATE FUNCTION mig_settings_object(value jsonb) RETURNS jsonb AS $$
	SELECT CASE
		WHEN jsonb_typeof(unwrapped) = 'object' THEN unwrapped
		ELSE '{}'::jsonb
	END
	FROM (
		SELECT CASE
			WHEN jsonb_typeof(value) = 'string' THEN (value #>> '{}')::jsonb
			ELSE value
		END AS unwrapped
	) parsed
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
CREATE FUNCTION mig_mirror_key(url text) RETURNS text AS $$
	SELECT coalesce(nullif(readable, ''), 'repo')
		|| '-'
		|| substr(encode(sha256(convert_to(url, 'UTF8')), 'hex'), 1, 10)
	FROM (
		SELECT substr(
			regexp_replace(
				regexp_replace(mig_normalize_remote(url), '[^a-z0-9._-]+', '-', 'g'),
			'^-+|-+$', '', 'g'),
		1, 64) AS readable
	) parts
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint

-- One row per distinct identity, drawn from everything that names a repository
-- today. Where two spellings fold together the row keeps the one belonging to the
-- most recently created task, so its mirror is the directory that exists; a
-- repository named only by a setting has no mirror yet and takes a key minted from
-- its identity.
INSERT INTO "repositories" ("normalized", "repo_url", "mirror_key")
SELECT DISTINCT ON (mig_normalize_remote(raw))
	mig_normalize_remote(raw),
	raw,
	mig_mirror_key(raw)
FROM (
	SELECT "repo_url" AS raw, "created_at" AS at, 0 AS source FROM "tasks"
	UNION ALL
	SELECT "repo_url", "created_at", 1 FROM "coverage_waivers"
	UNION ALL
	SELECT mig_settings_object("value")->>'repoUrl', "updated_at", 2 FROM "app_settings"
		WHERE "key" = 'default-repository'
		  AND mig_settings_object("value")->>'repoUrl' IS NOT NULL
	UNION ALL
	SELECT entry.key, s."updated_at", 3 FROM "app_settings" s
		CROSS JOIN LATERAL jsonb_each(mig_settings_object(s."value")) AS entry
		WHERE s."key" = 'spec-conventions'
) remotes
ORDER BY mig_normalize_remote(raw), source, at DESC;--> statement-breakpoint

UPDATE "repositories" r SET "default_branch" = latest."base_branch"
FROM (
	SELECT DISTINCT ON (mig_normalize_remote("repo_url"))
		mig_normalize_remote("repo_url") AS normalized,
		"base_branch"
	FROM "tasks"
	WHERE "base_branch" IS NOT NULL
	ORDER BY mig_normalize_remote("repo_url"), "created_at" DESC
) latest
WHERE latest.normalized = r."normalized";--> statement-breakpoint

-- The two settings keyed by repository move onto the row they were always about.
UPDATE "repositories" r SET "spec_convention" = entry.value
FROM "app_settings" s CROSS JOIN LATERAL jsonb_each(mig_settings_object(s."value")) AS entry
WHERE s."key" = 'spec-conventions' AND entry.key = r."normalized";--> statement-breakpoint

UPDATE "repositories" r SET "is_default" = true
FROM "app_settings" s
WHERE s."key" = 'default-repository'
	AND mig_normalize_remote(mig_settings_object(s."value")->>'repoUrl') = r."normalized";--> statement-breakpoint

DELETE FROM "app_settings" WHERE "key" IN ('spec-conventions', 'default-repository');--> statement-breakpoint

ALTER TABLE "tasks" ADD COLUMN "repository_id" uuid;--> statement-breakpoint
UPDATE "tasks" t SET "repository_id" = r."id"
FROM "repositories" r WHERE r."normalized" = mig_normalize_remote(t."repo_url");--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "repository_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "coverage_waivers" ADD COLUMN "repository_id" uuid;--> statement-breakpoint
UPDATE "coverage_waivers" w SET "repository_id" = r."id"
FROM "repositories" r WHERE r."normalized" = mig_normalize_remote(w."repo_url");--> statement-breakpoint
ALTER TABLE "coverage_waivers" ALTER COLUMN "repository_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coverage_waivers" ADD CONSTRAINT "coverage_waivers_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Two spellings could each hold an acceptance open; per the record only one can.
-- The most recent stays in force and the rest are stamped revoked rather than
-- deleted, because REQ-315 says a revoked acceptance stays readable.
DROP INDEX "coverage_waivers_in_force_idx";--> statement-breakpoint
UPDATE "coverage_waivers" w SET "revoked_at" = now()
WHERE w."revoked_at" IS NULL
	AND w."id" <> (
		SELECT other."id" FROM "coverage_waivers" other
		WHERE other."repository_id" = w."repository_id" AND other."revoked_at" IS NULL
		ORDER BY other."created_at" DESC, other."id" DESC
		LIMIT 1
	);--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_waivers_in_force_idx" ON "coverage_waivers" USING btree ("repository_id") WHERE "coverage_waivers"."revoked_at" is null;--> statement-breakpoint

DROP FUNCTION mig_settings_object(jsonb);--> statement-breakpoint
DROP FUNCTION mig_mirror_key(text);--> statement-breakpoint
DROP FUNCTION mig_normalize_remote(text);
