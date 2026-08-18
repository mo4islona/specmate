import {
  type Caps,
  collapseWhitespace,
  type ReviewFinding,
  type ReviewVerdict,
  renderFindingBullets,
} from '@specmate/core'
import { type Database, feedback, iterations, stages, tasks } from '@specmate/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { RunnerConfig } from './config.ts'
import { truncate } from './truncate.ts'

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} does not exist`)
    this.name = 'TaskNotFoundError'
  }
}

export interface LedgerRound {
  readonly loop: 'spec' | 'impl'
  readonly round: number
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
}

export interface LedgerGateComment {
  readonly nodeKey: string
  readonly kind: 'redirect' | 'rework'
  readonly comment: string
}

export interface LedgerSnapshot {
  readonly title: string
  /** The owner's own words the task was launched with; the title stands in when absent. */
  readonly ask: string
  readonly slug: string
  readonly type: string
  readonly repoUrl: string
  readonly baseBranch: string
  readonly status: string
  readonly harnessStatus: string
  /** The most recent probe's evidence, short form — null before any probe has run. */
  readonly harnessEvidence: string | null
  readonly caps: Caps
  readonly rounds: readonly LedgerRound[]
  readonly interventions: readonly {
    id: string
    instruction: string
    target: Record<string, unknown> | null
  }[]
  /** Redirect and rework comments the owner left at a gate, oldest first. */
  readonly gateComments: readonly LedgerGateComment[]
}

export async function loadLedgerSnapshot(db: Database, taskId: string): Promise<LedgerSnapshot> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) throw new TaskNotFoundError(taskId)

  // Interventions and gate comments both live in `feedback`; one query fetches
  // the rows either can need, split client-side by kind below. The left join
  // to `stages` only matters to the intervention filter — a gate comment has
  // no consuming stage and passes through it untouched.
  const [rounds, feedbackRows, probeRows] = await Promise.all([
    db
      .select()
      .from(iterations)
      .where(eq(iterations.taskId, taskId))
      .orderBy(asc(iterations.loop), asc(iterations.round)),
    db
      .select({
        id: feedback.id,
        kind: feedback.kind,
        textMd: feedback.textMd,
        target: feedback.target,
        stageStatus: stages.status,
      })
      .from(feedback)
      .leftJoin(stages, eq(feedback.consumedByStageId, stages.id))
      .where(
        and(
          eq(feedback.taskId, taskId),
          inArray(feedback.kind, ['intervention', 'redirect', 'rework']),
        ),
      )
      .orderBy(asc(feedback.createdAt)),
    // Evidence lives on the probing stage's own result, not a task column
    // (REQ-1401: data, never re-derived) — the most recent one that carried
    // an assessment is the classification `task.harnessStatus` reflects now.
    db
      .select({ result: stages.result })
      .from(stages)
      .where(
        and(eq(stages.taskId, taskId), sql`${stages.result} ->> 'harness_coverage' is not null`),
      )
      .orderBy(desc(stages.finishedAt))
      .limit(1),
  ])
  const harnessEvidence = probeRows[0]?.result?.harness_coverage?.evidence_md ?? null

  const interventions = feedbackRows
    .filter((row) => row.kind === 'intervention' && row.stageStatus === 'running')
    .map((row) => ({ id: row.id, instruction: row.textMd, target: row.target }))

  const gateComments = feedbackRows
    .filter((row) => row.kind === 'redirect' || row.kind === 'rework')
    .map((row) => ({
      nodeKey: typeof row.target?.nodeKey === 'string' ? row.target.nodeKey : 'unknown',
      kind: row.kind as 'redirect' | 'rework',
      comment: row.textMd,
    }))

  return {
    title: task.title,
    ask: task.description?.trim() || task.title,
    slug: task.slug,
    type: task.type,
    repoUrl: task.repoUrl,
    baseBranch: task.baseBranch,
    status: task.status,
    harnessStatus: task.harnessStatus,
    harnessEvidence,
    caps: task.caps,
    rounds: rounds.map((round) => ({
      loop: round.loop,
      round: round.round,
      verdict: round.reviewerVerdict,
      findings: round.findings,
    })),
    interventions,
    gateComments,
  }
}

/**
 * The only state a stage receives that is not a file. Deliberately small and
 * deliberately free of transcripts: a stage's context is its artifacts, and the
 * ledger says where in the loop those artifacts are. Nothing here varies
 * between two renders of the same state — timestamps included — because an
 * identical stage must assemble an identical prompt.
 */
export function renderLedger(config: RunnerConfig, snapshot: LedgerSnapshot): string {
  // Collapsed once and checked for its own truthiness — a whitespace-only
  // evidence_md (valid under the assessment schema's z.string().min(1),
  // which does not trim) must read as absent, not as a dangling "— ".
  const harnessEvidence = snapshot.harnessEvidence
    ? collapseWhitespace(snapshot.harnessEvidence)
    : ''

  const lines = [
    '## Task',
    '',
    `- Title: ${snapshot.title}`,
    `- Ask: ${snapshot.ask}`,
    `- Slug: ${snapshot.slug}`,
    `- Type: ${snapshot.type}`,
    `- Repository: ${snapshot.repoUrl}`,
    `- Base branch: ${snapshot.baseBranch}`,
    `- Current state: ${snapshot.status}`,
    `- Harness coverage: ${snapshot.harnessStatus}${harnessEvidence ? ` — ${harnessEvidence}` : ''}`,
    '',
    '## Loops',
    '',
  ]

  for (const loop of ['spec', 'impl'] as const) {
    const done = snapshot.rounds.filter((round) => round.loop === loop)
    const cap =
      loop === 'spec' ? snapshot.caps.max_spec_iterations : snapshot.caps.max_impl_iterations
    lines.push(`- ${loop}: ${done.length} round(s) completed, cap ${cap}`)
  }

  const last = snapshot.rounds.at(-1)
  lines.push('', '## Previous review round', '')
  if (!last) {
    lines.push('No review has run yet.')
  } else {
    lines.push(`- Loop: ${last.loop}, round ${last.round}`, `- Verdict: ${last.verdict}`, '')
    lines.push(
      ...renderFindingBullets(last.findings, {
        header: 'Findings the reviewer raised, which this round is expected to address:',
        empty: 'The reviewer recorded no findings.',
      }),
    )
  }

  // Interventions are live guidance for the run about to start; gate comments
  // are history. Interventions come first so an unbounded gate-comment history
  // is what truncate() cuts first, not the guidance this attempt needs.
  lines.push('', '## Confirmed interventions', '')
  if (snapshot.interventions.length === 0) {
    lines.push('No confirmed intervention targets this run.')
  } else {
    for (const intervention of snapshot.interventions) {
      lines.push(
        `- Intervention ${intervention.id}: ${intervention.instruction}`,
        `  Target: ${JSON.stringify(intervention.target ?? {})}`,
      )
    }
  }

  lines.push('', '## Gate comments', '')
  if (snapshot.gateComments.length === 0) {
    lines.push('No gate comments recorded.')
  } else {
    // Newest first: truncate() cuts from the tail, so this is the order in
    // which this section's own comments are sacrificed if it alone overflows.
    for (const gateComment of [...snapshot.gateComments].reverse()) {
      lines.push(`- At ${gateComment.nodeKey} (${gateComment.kind}): ${gateComment.comment}`)
    }
  }

  return truncate(`${lines.join('\n')}\n`, config.ledgerBytesLimit, 'ledger')
}

export async function renderLedgerForTask(
  db: Database,
  config: RunnerConfig,
  taskId: string,
): Promise<string> {
  return renderLedger(config, await loadLedgerSnapshot(db, taskId))
}
