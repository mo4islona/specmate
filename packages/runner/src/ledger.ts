import {
  type Caps,
  type ReviewFinding,
  type ReviewVerdict,
  renderFindingBullets,
} from '@specmate/core'
import { type Database, feedback, iterations, stages, tasks } from '@specmate/db'
import { and, asc, eq } from 'drizzle-orm'
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

export interface LedgerSnapshot {
  readonly title: string
  readonly slug: string
  readonly type: string
  readonly repoUrl: string
  readonly baseBranch: string
  readonly status: string
  readonly harnessStatus: string
  readonly caps: Caps
  readonly rounds: readonly LedgerRound[]
  readonly interventions: readonly {
    id: string
    instruction: string
    target: Record<string, unknown> | null
  }[]
}

export async function loadLedgerSnapshot(db: Database, taskId: string): Promise<LedgerSnapshot> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) throw new TaskNotFoundError(taskId)

  const [rounds, interventions] = await Promise.all([
    db
      .select()
      .from(iterations)
      .where(eq(iterations.taskId, taskId))
      .orderBy(asc(iterations.loop), asc(iterations.round)),
    db
      .select({ id: feedback.id, instruction: feedback.textMd, target: feedback.target })
      .from(feedback)
      .innerJoin(stages, eq(feedback.consumedByStageId, stages.id))
      .where(
        and(
          eq(feedback.taskId, taskId),
          eq(feedback.kind, 'intervention'),
          eq(stages.status, 'running'),
        ),
      )
      .orderBy(asc(feedback.createdAt)),
  ])

  return {
    title: task.title,
    slug: task.slug,
    type: task.type,
    repoUrl: task.repoUrl,
    baseBranch: task.baseBranch,
    status: task.status,
    harnessStatus: task.harnessStatus,
    caps: task.caps,
    rounds: rounds.map((round) => ({
      loop: round.loop,
      round: round.round,
      verdict: round.reviewerVerdict,
      findings: round.findings,
    })),
    interventions,
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
  const lines = [
    '## Task',
    '',
    `- Title: ${snapshot.title}`,
    `- Slug: ${snapshot.slug}`,
    `- Type: ${snapshot.type}`,
    `- Repository: ${snapshot.repoUrl}`,
    `- Base branch: ${snapshot.baseBranch}`,
    `- Current state: ${snapshot.status}`,
    `- Harness coverage: ${snapshot.harnessStatus}`,
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

  return truncate(`${lines.join('\n')}\n`, config.ledgerBytesLimit, 'ledger')
}

export async function renderLedgerForTask(
  db: Database,
  config: RunnerConfig,
  taskId: string,
): Promise<string> {
  return renderLedger(config, await loadLedgerSnapshot(db, taskId))
}
