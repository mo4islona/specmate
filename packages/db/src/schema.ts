import {
  type Budgets,
  type Caps,
  DEFAULT_BUDGETS,
  DEFAULT_CAPS,
  type ExecutionEnvironment,
  type PinnedGraph,
  type ReviewFinding,
  type StageResult,
  type TaskState,
} from '@specmate/core'
import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Not drizzle's jsonb: that one pre-stringifies values and bun's SQL driver
 * stringifies again, landing a JSON *string* in the column and breaking every
 * `->` query. Handing the driver the raw value stores a real object; reads
 * still unwrap rows the double-encoding era left behind.
 */
const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => value,
  fromDriver: (value) => {
    if (typeof value !== 'string') return value

    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  },
})

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// ─── enums ────────────────────────────────────────────────────────────────────

export const providerEnum = pgEnum('provider', ['claude-code', 'codex', 'copilot'])
export const authStateEnum = pgEnum('auth_state', ['ok', 'expired', 'unknown'])
export const taskTypeEnum = pgEnum('task_type', ['feature', 'bugfix'])
export const taskStatusEnum = pgEnum('task_status', [
  'draft',
  'planning',
  'kickoff_brief',
  'human_kickoff_gate',
  'research',
  'spec_review',
  'human_spec_gate',
  'implement',
  'verify',
  'code_review',
  'summarize',
  'human_final_gate',
  'publish',
  'archived',
  'waiting_human',
  'paused',
  'blocked',
  'cancelled',
  'failed',
])
export const harnessStatusEnum = pgEnum('harness_status', [
  'unknown',
  'adequate',
  'partial',
  'missing',
  'waived',
])
export const roleEnum = pgEnum('agent_role', [
  'planner',
  'researcher',
  'spec_writer',
  'implementer',
  'verifier',
  'reviewer',
  'summarizer',
  'retro',
])
export const stageStatusEnum = pgEnum('stage_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'waiting_human',
])
export const loopEnum = pgEnum('loop_kind', ['spec', 'impl'])
export const verdictEnum = pgEnum('review_verdict', ['approve', 'revise', 'escalate'])
export const decisionKindEnum = pgEnum('decision_kind', [
  'question',
  'escalation',
  'rework',
  'approval',
])
export const decisionStatusEnum = pgEnum('decision_status', ['open', 'answered', 'dismissed'])
export const artifactKindEnum = pgEnum('artifact_kind', [
  'proposal',
  'spec',
  'design',
  'tasks',
  'review',
  'verification',
  'summary',
  'decision_log',
])
export const prStateEnum = pgEnum('pr_state', ['open', 'merged', 'closed'])
export const feedbackKindEnum = pgEnum('feedback_kind', [
  'redirect',
  'decision_answer',
  'spec_edit',
  'rework',
  'overrule',
])

// ─── providers (single owner: no accounts table) ──────────────────────────────

export const providerCredentials = pgTable('provider_credentials', {
  id: uuid().primaryKey().defaultRandom(),
  provider: providerEnum().notNull().unique(),
  authState: authStateEnum('auth_state').notNull().default('unknown'),
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  updatedAt: timestamps.updatedAt,
})

// ─── tasks ────────────────────────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    title: text().notNull(),
    type: taskTypeEnum().notNull(),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull().default('main'),
    status: taskStatusEnum().notNull().default('draft').$type<TaskState>(),
    /** State to return to once a human gate / pause resolves. */
    resumeStatus: taskStatusEnum('resume_status').$type<TaskState>(),
    /** Task splits: harness task A blocks fix task B (§6). */
    blockedBy: uuid('blocked_by').array().notNull().default(sql`'{}'::uuid[]`),
    harnessStatus: harnessStatusEnum('harness_status').notNull().default('unknown'),
    // Resolved at creation, not merged at read time: a task records the caps it ran with.
    budgets: jsonb()
      .$type<Budgets>()
      .notNull()
      .default({ ...DEFAULT_BUDGETS }),
    caps: jsonb()
      .$type<Caps>()
      .notNull()
      .default({ ...DEFAULT_CAPS }),
    environment: jsonb().$type<ExecutionEnvironment>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('tasks_slug_idx').on(t.slug), index('tasks_status_idx').on(t.status)],
)

// ─── planned graph & execution ────────────────────────────────────────────────

export const runGraphs = pgTable(
  'run_graphs',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    version: integer().notNull().default(1),
    /** The task's own copy of its pipeline definition; the engine consults nothing else. */
    dag: jsonb().$type<PinnedGraph>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('run_graphs_task_version_idx').on(t.taskId, t.version)],
)

/**
 * Execution telemetry per attempt (persistence spec). Absent values are null —
 * never zero — so "no data" stays distinguishable from "free".
 */
export interface StageUsage {
  model?: string | null
  tokens?: Record<string, number> | null
  costUsd?: number | null
  /** The provider's raw envelope, for what the normalized fields missed. */
  raw?: unknown
  failure?: { reason: string; detail?: string } | null
}

export const stages = pgTable(
  'stages',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    graphId: uuid('graph_id')
      .notNull()
      .references(() => runGraphs.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(),
    role: roleEnum().notNull(),
    provider: providerEnum().notNull(),
    status: stageStatusEnum().notNull().default('pending'),
    attempt: integer().notNull().default(0),
    /** Spec-standard skill SHA in force for this run (§11.2). */
    skillSha: text('skill_sha'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    cost: jsonb().$type<StageUsage>().notNull().default({}),
    result: jsonb().$type<StageResult>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stages_graph_node_attempt_idx').on(t.graphId, t.nodeKey, t.attempt),
    index('stages_task_status_idx').on(t.taskId, t.status),
  ],
)

// ─── loop control ─────────────────────────────────────────────────────────────

export const iterations = pgTable(
  'iterations',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    loop: loopEnum().notNull(),
    round: integer().notNull(),
    reviewerVerdict: verdictEnum('reviewer_verdict').notNull(),
    findings: jsonb().$type<ReviewFinding[]>().notNull().default([]),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex('iterations_task_loop_round_idx').on(t.taskId, t.loop, t.round)],
)

// ─── human-in-the-loop ────────────────────────────────────────────────────────

export const decisions = pgTable(
  'decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    /** Stable per-stage key so a re-asked question maps to the same record. */
    key: text().notNull(),
    kind: decisionKindEnum().notNull(),
    promptMd: text('prompt_md').notNull(),
    options: jsonb().$type<{ id: string; label: string }[]>().notNull().default([]),
    answerMd: text('answer_md'),
    answeredBy: text('answered_by'),
    status: decisionStatusEnum().notNull().default('open'),
    createdAt: timestamps.createdAt,
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [index('decisions_open_idx').on(t.status, t.createdAt)],
)

// ─── artifacts index (git is the store; Postgres indexes it) ──────────────────

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    path: text().notNull(),
    kind: artifactKindEnum().notNull(),
    gitSha: text('git_sha'),
    snapshotMd: text('snapshot_md'),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [uniqueIndex('artifacts_task_path_idx').on(t.taskId, t.path)],
)

// ─── spec-standard skill sync ─────────────────────────────────────────────────

export const skillSources = pgTable(
  'skill_sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    repoUrl: text('repo_url').notNull(),
    ref: text().notNull().default('main'),
    path: text().notNull().default('.'),
    injectInto: roleEnum('inject_into').array().notNull().default(sql`'{}'::agent_role[]`),
    currentSha: text('current_sha'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    enabled: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex('skill_sources_name_idx').on(t.name)],
)

// ─── PR tracking for the attention inbox ──────────────────────────────────────

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    state: prStateEnum().notNull().default('open'),
    checksState: text('checks_state'),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [uniqueIndex('pull_requests_url_idx').on(t.url)],
)

// ─── self-learning signal ─────────────────────────────────────────────────────

export const feedback = pgTable(
  'feedback',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    role: roleEnum(),
    provider: providerEnum(),
    kind: feedbackKindEnum().notNull(),
    textMd: text('text_md').notNull(),
    /** Which role-prompt / policy versions this feedback corrects (§12.4). */
    promptVersions: jsonb('prompt_versions').$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('feedback_role_created_idx').on(t.role, t.createdAt)],
)

// ─── audit / replay / UI stream ───────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    /** Monotonic cursor for the WS/SSE stream. */
    seq: bigserial({ mode: 'number' }).primaryKey(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id').references(() => stages.id, { onDelete: 'set null' }),
    type: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('events_task_seq_idx').on(t.taskId, t.seq)],
)

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type Stage = typeof stages.$inferSelect
export type Decision = typeof decisions.$inferSelect
export type SpecEvent = typeof events.$inferSelect
