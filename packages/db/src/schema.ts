import {
  type Budgets,
  Caps,
  type ConversationActionStatus,
  type ConversationActionTarget,
  type ConversationExpectedVersion,
  type ConversationStatus,
  DEFAULT_BUDGETS,
  DEFAULT_CAPS,
  type ExecutionEnvironment,
  type ExecutionUsage,
  type ModelBindings,
  type PinnedGraph,
  PLAN_SIZES,
  type PlanSize,
  type ReviewFinding,
  resolveModelBindings,
  type SpecConvention,
  type SpecConventionSetting,
  type StageResult,
  type TaskState,
} from '@specmate/core'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
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

/**
 * `jsonb` whose read is a parse rather than a cast. A row written before a cap
 * existed answers `undefined` for it, and every bound conditioned on that cap
 * then fails open — `planDepth < undefined` is false, `slice(0, undefined)`
 * keeps everything, a cap of `undefined` refuses every request. A migration's
 * backfill only reaches the rows that existed when it ran; parsing on read
 * fills the defaults once, for every reader and every future cap (AC-339).
 */
const parsedJsonb = <T>(schema: { parse: (value: unknown) => T }) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => 'jsonb',
    toDriver: (value) => value,
    fromDriver: (value) => {
      let raw = value
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw)
        } catch {
          raw = undefined
        }
      }

      return schema.parse(raw ?? {})
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
// Mirrors `TASK_STATES`. Values only ever get added: a retired node key is still
// named by every graph pinned before it retired.
export const taskStatusEnum = pgEnum('task_status', [
  'draft',
  'planning',
  'kickoff_brief',
  'human_kickoff_gate',
  'specify',
  'research',
  'spec_review',
  'human_spec_gate',
  'implement',
  'validate',
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
export const planSizeEnum = pgEnum('plan_size', PLAN_SIZES)
// `verifier` and `researcher` stopped being scheduled when the pipeline was
// compressed; both stay because stage rows written before that name them.
export const roleEnum = pgEnum('agent_role', [
  'planner',
  'researcher',
  'spec_writer',
  'implementer',
  'verifier',
  'validator',
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
  'interrupted',
])
export const stageCleanupStatusEnum = pgEnum('stage_cleanup_status', [
  'pending',
  'succeeded',
  'failed',
])
export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'closed'])
export const conversationMessageRoleEnum = pgEnum('conversation_message_role', [
  'owner',
  'assistant',
  'system',
])
export const conversationMessageStatusEnum = pgEnum('conversation_message_status', [
  'completed',
  'queued',
  'responding',
  'failed',
])
export const conversationActionKindEnum = pgEnum('conversation_action_kind', [
  'answer_decision',
  'dismiss_decision',
  'approve_gate',
  'redirect_gate',
  'rework_gate',
  'instruct_next_run',
  'restart_stage',
])
export const conversationActionStatusEnum = pgEnum('conversation_action_status', [
  'proposed',
  'confirmed',
  'applying',
  'applied',
  'conflict',
  'failed',
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
  'comment',
  'conversation',
  'intervention',
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

/**
 * A future setting is a new row here, not a migration — see model-settings/design.md.
 * `model-defaults` is wired up today; nothing generic reads or writes an arbitrary key.
 * What a repository is has a table of its own (REQ-316) — a setting keyed by URL string
 * was how the default and the spec convention got in here, and both are columns now.
 */
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamps.updatedAt,
})

// ─── repositories ─────────────────────────────────────────────────────────────

/**
 * REQ-316. A repository is a record, not an aggregate over the tasks that named it,
 * so the two facts an owner states in advance — the default, and the specification
 * that governs it — are stated about something that exists.
 */
export const repositories = pgTable(
  'repositories',
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * The identity: `normalizeRemote`'s form, which folds the SSH and HTTPS spellings
     * of one remote together. Unique, so the database is what holds them to one row.
     */
    normalized: text().notNull(),
    /** The remote as the owner wrote it. A display string; identity is `normalized`. */
    repoUrl: text('repo_url').notNull(),
    /**
     * Where this repository's files already live. Recorded rather than recomputed
     * (D1): `mirrorKey` digests the raw URL, so once two spellings share a row it
     * answers differently depending on which string the caller happened to hold.
     */
    mirrorKey: text('mirror_key').notNull(),
    /** Resolved by provisioning; null until a task has run and found it (REQ-703). */
    defaultBranch: text('default_branch'),
    /** What the owner set for this repository, or null where detection governs (REQ-1702). */
    specConvention: jsonb('spec_convention').$type<SpecConventionSetting>(),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('repositories_normalized_idx').on(t.normalized),
    // Also the id the REST surface addresses a repository by, so it has to be one row.
    uniqueIndex('repositories_mirror_key_idx').on(t.mirrorKey),
    // At most one default, said by the database rather than by whoever writes it.
    uniqueIndex('repositories_default_idx').on(t.isDefault).where(sql`${t.isDefault}`),
  ],
)

// ─── tasks ────────────────────────────────────────────────────────────────────

export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    title: text().notNull(),
    /** The owner's request in their own words; absent on a title-only launch. */
    description: text(),
    type: taskTypeEnum().notNull(),
    /**
     * The remote this run actually used, kept beside the key rather than read through
     * it (D2): a repository may be respelled later, and what a task ran against is a
     * fact about that run. It is also the evidence the backfill can be audited from.
     */
    repoUrl: text('repo_url').notNull(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    /** Null means the repository's default branch, resolved at provisioning (REQ-703). */
    baseBranch: text('base_branch'),
    status: taskStatusEnum().notNull().default('draft').$type<TaskState>(),
    /** State to return to once a human gate / pause resolves. */
    resumeStatus: taskStatusEnum('resume_status').$type<TaskState>(),
    /** Task splits: harness task A blocks fix task B (§6). */
    blockedBy: uuid('blocked_by').array().notNull().default(sql`'{}'::uuid[]`),
    /** The task whose plan created this one; null for a task the owner launched (REQ-617). */
    originTaskId: uuid('origin_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'set null',
    }),
    /** Denormalised so the depth cap is a column read, not a walk up the chain. */
    planDepth: integer('plan_depth').notNull().default(0),
    /** The size in force; null until something declares one. Selects the pipeline profile (REQ-408). */
    planSize: planSizeEnum('plan_size').$type<PlanSize>(),
    /**
     * The size the owner declared at launch, kept because `plan_size` also holds the
     * one planning declares and the two are otherwise indistinguishable: a redirect
     * re-runs planning, and its second declaration must be able to correct its first
     * without touching a size the owner chose (AC-641 makes the same argument for caps).
     */
    planSizeOverride: planSizeEnum('plan_size_override').$type<PlanSize>(),
    /**
     * What planning called the change, which names its folder (REQ-705). Null
     * until planning has declared one — and for every task that predates the
     * declaration, whose folder stays named after its slug.
     */
    changeName: text('change_name'),
    harnessStatus: harnessStatusEnum('harness_status').notNull().default('unknown'),
    /**
     * Resolved by provisioning, which is the only code that sees the working tree and
     * the owner's setting at once (REQ-1702). Null means not yet determined: a task
     * pinned before the column existed, until its next stage re-provisions.
     */
    specConvention: jsonb('spec_convention').$type<SpecConvention>(),
    // Resolved at creation, not merged at read time: a task records the caps it ran with.
    budgets: jsonb()
      .$type<Budgets>()
      .notNull()
      .default({ ...DEFAULT_BUDGETS }),
    caps: parsedJsonb(Caps)('caps')
      .notNull()
      .default({ ...DEFAULT_CAPS }),
    /**
     * The cap fields the owner named at creation, kept because `caps` resolves them
     * into a full object and the declared size later rewrites the fields nobody chose.
     * Without this the two are indistinguishable and a declaration would silently
     * overwrite a deliberate override (AC-641).
     */
    capsOverride: jsonb('caps_override').$type<Partial<Caps>>().notNull().default({}),
    modelBindings: jsonb('model_bindings')
      .$type<ModelBindings>()
      .notNull()
      .default(resolveModelBindings({})),
    environment: jsonb().$type<ExecutionEnvironment>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('tasks_slug_idx').on(t.slug), index('tasks_status_idx').on(t.status)],
)

// ─── planned graph & execution ────────────────────────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    status: conversationStatusEnum().notNull().default('open').$type<ConversationStatus>(),
    lastSequence: integer('last_sequence').notNull().default(0),
    contextCommit: text('context_commit'),
    contextTaskState: taskStatusEnum('context_task_state').$type<TaskState>(),
    summaryMd: text('summary_md'),
    summaryThrough: integer('summary_through').notNull().default(0),
    providerSession: jsonb('provider_session').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    index('conversations_task_status_created_idx').on(t.taskId, t.status, t.createdAt),
    uniqueIndex('conversations_subject_idx')
      .on(t.taskId, t.subjectKind, t.subjectId)
      .where(sql`${t.subjectKind} is not null and ${t.subjectId} is not null`),
  ],
)

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sequence: integer().notNull(),
    replyToMessageId: uuid('reply_to_message_id'),
    role: conversationMessageRoleEnum().notNull(),
    contentMd: text('content_md').notNull().default(''),
    status: conversationMessageStatusEnum().notNull(),
    stageId: uuid('stage_id'),
    taskState: taskStatusEnum('task_state').notNull().$type<TaskState>(),
    contextCommit: text('context_commit'),
    provider: providerEnum(),
    telemetry: jsonb().$type<ExecutionUsage[]>().notNull().default([]),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('conversation_messages_order_idx').on(t.conversationId, t.sequence),
    uniqueIndex('conversation_messages_reply_idx')
      .on(t.replyToMessageId)
      .where(sql`${t.replyToMessageId} is not null`),
    uniqueIndex('conversation_messages_one_active_idx')
      .on(t.conversationId)
      .where(sql`${t.status} = 'responding'`),
    index('conversation_messages_queue_idx').on(t.status, t.createdAt),
  ],
)

export const conversationActions = pgTable(
  'conversation_actions',
  {
    id: uuid().primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    kind: conversationActionKindEnum().notNull(),
    target: jsonb().$type<ConversationActionTarget>().notNull(),
    instruction: text(),
    expectedVersion: jsonb('expected_version').$type<ConversationExpectedVersion>().notNull(),
    actor: text(),
    status: conversationActionStatusEnum()
      .notNull()
      .default('proposed')
      .$type<ConversationActionStatus>(),
    outcome: jsonb().$type<Record<string, unknown>>(),
    idempotencyKey: text('idempotency_key'),
    ...timestamps,
  },
  (t) => [
    index('conversation_actions_conversation_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('conversation_actions_idempotency_idx')
      .on(t.taskId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
)

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
export type StageUsage = ExecutionUsage

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
    /**
     * The provider session this attempt ran under, so a later node can continue it
     * (REQ-214). Recorded whether or not anything resumes it: a session that turns
     * out to be unresumable is worth knowing about, and it costs one column.
     */
    providerSessionId: text('provider_session_id'),
    /** Set when a resuming stage had to run cold, with the reason (AC-235). */
    coldStartReason: text('cold_start_reason'),
    /**
     * Why a conditional node did not run (AC-422). The row exists precisely so the
     * skip is visible: a node dropped from the graph hides the decision that dropped
     * it, and every surface renders this where a node that ran states its duration.
     */
    skipReason: text('skip_reason'),
    /** Task branch HEAD captured before this attempt starts. */
    workspaceCommit: text('workspace_commit'),
    acceptedCommit: text('accepted_commit'),
    interruptedBy: text('interrupted_by'),
    interruptionActionId: uuid('interruption_action_id').references(() => conversationActions.id, {
      onDelete: 'set null',
    }),
    interruptionCleanupStatus: stageCleanupStatusEnum('interruption_cleanup_status'),
    interruptionFailure: text('interruption_failure'),
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
    /** The pinned-graph node that raised this decision — a re-ask at the same node and key attaches. */
    nodeKey: text('node_key').notNull(),
    /** Stable per-node key so a re-asked question maps to the same record. */
    key: text().notNull(),
    kind: decisionKindEnum().notNull(),
    promptMd: text('prompt_md').notNull(),
    options: jsonb().$type<{ id: string; label: string }[]>().notNull().default([]),
    /** Non-blocking decisions are recorded and surfaced without parking the task. */
    blocking: boolean().notNull().default(true),
    answerMd: text('answer_md'),
    answeredBy: text('answered_by'),
    status: decisionStatusEnum().notNull().default('open'),
    createdAt: timestamps.createdAt,
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    index('decisions_open_idx').on(t.status, t.createdAt),
    // Identity is (node, key), unique only while open: a retry attaches instead
    // of duplicating, and a re-ask after an answer opens a fresh record.
    uniqueIndex('decisions_open_node_key_idx')
      .on(t.taskId, t.nodeKey, t.key)
      .where(sql`${t.status} = 'open'`),
  ],
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

/**
 * The owner's acceptance of a repository's harness gap, kept where the next
 * task against that repository can find it (REQ-315). The task-level waiver
 * (`tasks.harnessStatus = 'waived'`) says this task proceeded without adequate
 * coverage; this says the repository has been accepted as under-covered, so
 * the next task inherits the answer instead of asking for it again.
 *
 * Revoking sets `revokedAt` rather than deleting: what the owner accepted, and
 * when they took it back, both stay readable. The partial unique index is what
 * keeps "at most one in force per repository" a database guarantee rather than
 * a promise from the code that writes it.
 */
export const coverageWaivers = pgTable(
  'coverage_waivers',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** The spelling the acceptance was written under; in force is decided by the key. */
    repoUrl: text('repo_url').notNull(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'restrict' }),
    /** The task whose resolution accepted it; nulled rather than cascaded, so the waiver outlives it. */
    originTaskId: uuid('origin_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // REQ-315: one in force per repository, and per the record rather than per spelling,
    // so two spellings of one remote cannot each hold an acceptance open.
    uniqueIndex('coverage_waivers_in_force_idx')
      .on(t.repositoryId)
      .where(sql`${t.revokedAt} is null`),
  ],
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
    target: jsonb().$type<Record<string, unknown>>(),
    idempotencyKey: text('idempotency_key'),
    consumedByStageId: uuid('consumed_by_stage_id'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('feedback_role_created_idx').on(t.role, t.createdAt),
    uniqueIndex('feedback_task_idempotency_idx')
      .on(t.taskId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
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
export type AppSetting = typeof appSettings.$inferSelect
export type Conversation = typeof conversations.$inferSelect
export type ConversationMessage = typeof conversationMessages.$inferSelect
export type ConversationAction = typeof conversationActions.$inferSelect
export type Stage = typeof stages.$inferSelect
export type Decision = typeof decisions.$inferSelect
export type CoverageWaiver = typeof coverageWaivers.$inferSelect
export type SpecEvent = typeof events.$inferSelect
