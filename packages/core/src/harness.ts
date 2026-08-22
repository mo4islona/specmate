import { z } from 'zod'
import type { PlanPrerequisite } from './plan.ts'

/** What a probe can conclude about the area a task touches. */
export const HARNESS_CLASSIFICATIONS = ['adequate', 'partial', 'missing'] as const
export const HarnessClassification = z.enum(HARNESS_CLASSIFICATIONS)
export type HarnessClassification = z.infer<typeof HarnessClassification>

/** The task's durable field: a probe's classification, plus `unknown` before planning and `waived` once accepted. */
export const HARNESS_STATUSES = ['unknown', 'adequate', 'partial', 'missing', 'waived'] as const
export const HarnessStatus = z.enum(HARNESS_STATUSES)
export type HarnessStatus = z.infer<typeof HarnessStatus>

export const HarnessCoverageAssessment = z.object({
  classification: HarnessClassification,
  /** What the judgement rests on — the suites, fixtures, or simulators found, or their absence. */
  evidence_md: z.string().min(1),
})
export type HarnessCoverageAssessment = z.infer<typeof HarnessCoverageAssessment>

/** REQ-1402: anything short of adequate needs the brief's mandatory warning. */
export function needsCoverageWarning(status: HarnessStatus): boolean {
  return status !== 'adequate'
}

/**
 * The durable statuses that represent a gap there is something to accept. Not
 * the negation of `needsCoverageWarning`: `unknown` means no probe has spoken
 * yet, and `waived` means the acceptance already happened — neither is a gap a
 * fresh acceptance may be recorded against.
 */
export function isCoverageGap(status: HarnessStatus): boolean {
  return status === 'partial' || status === 'missing'
}

/** The Key Points bullet label `checkBrief` looks for and `roles/planner.md` writes. */
export const HARNESS_GAP_LABEL = 'Harness gap'

/**
 * What the owner is choosing between at the kickoff gate (REQ-1403). The
 * decision is one card raised for either reason — a coverage gap, a plan that
 * proposes work first, or both — so the prompt is assembled from whichever
 * applies rather than written twice.
 */
export interface PlanChoice {
  readonly assessment: HarnessCoverageAssessment | null
  /** What splitting would create, already capped. */
  readonly creates: readonly PlanPrerequisite[]
  /** Proposed but not creatable — named, never silently dropped. */
  readonly dropped: readonly PlanPrerequisite[]
  /** Why `dropped` is not being created: the width cap, or the depth cap that forbids creating anything. */
  readonly dropReason: 'count' | 'depth' | null
  /** False once the task sits at `max_plan_depth`: splitting is not on offer. */
  readonly splittable: boolean
  readonly depthCap: number
}

function hasCoverageGap(choice: PlanChoice): boolean {
  return choice.assessment ? choice.assessment.classification !== 'adequate' : false
}

/** True when there is anything to ask the owner about at all. */
export function needsPlanChoice(choice: PlanChoice): boolean {
  return hasCoverageGap(choice) || choice.creates.length > 0 || choice.dropped.length > 0
}

/**
 * Whether splitting would actually create anything: the plan's own proposals,
 * or the harness task a coverage gap falls back to. Without either, the option
 * would resolve into a no-op the owner cannot tell from a refusal.
 */
export function splitCreatesWork(choice: PlanChoice): boolean {
  return choice.splittable && (choice.creates.length > 0 || hasCoverageGap(choice))
}

/** The evidence and the proposals, stated plainly, ahead of the choice. */
export function renderPlanChoicePrompt(choice: PlanChoice): string {
  const lines: string[] = []

  if (choice.assessment && hasCoverageGap(choice)) {
    lines.push(
      `Harness coverage for the area this task touches is **${choice.assessment.classification}**.`,
      '',
      choice.assessment.evidence_md.trim(),
      '',
      'The result cannot be properly validated without addressing this.',
      '',
    )
  }

  if (choice.creates.length > 0) {
    lines.push('Planning judged that this work should land first:', '')
    for (const prerequisite of choice.creates) {
      lines.push(`- **${prerequisite.title}** — ${prerequisite.why_md.trim()}`)
    }
    lines.push('')
  }

  if (choice.dropped.length > 0) {
    const reason =
      choice.dropReason === 'depth'
        ? 'which will not be created — this task is already at the configured chain depth:'
        : `which will not be created — one plan may create at most ${choice.creates.length}:`
    lines.push(
      `Planning also proposed work ${reason}`,
      '',
      ...choice.dropped.map((prerequisite) => `- ${prerequisite.title}`),
      '',
    )
  }

  const gap = hasCoverageGap(choice)

  lines.push('Choose how to proceed:')
  if (splitCreatesWork(choice)) {
    lines.push(
      choice.creates.length > 0
        ? '- Do that work first, as separate tasks this one waits on.'
        : '- Build the harness first, as a separate task this one waits on.',
    )
  }
  lines.push(
    gap
      ? '- Proceed as one task, accepting that the work cannot be properly validated.'
      : '- Proceed as one task.',
  )
  lines.push('- Cancel this task.')

  if (!choice.splittable) {
    lines.push(
      '',
      `Splitting is not offered: this task is already ${choice.depthCap} level(s) deep in a chain of planned tasks, which is the configured limit.`,
    )
  }

  return lines.join('\n')
}

/**
 * What an inherited acceptance says. It is written already resolved, so this
 * is a record of what was applied rather than a question — it states the gap,
 * where the acceptance came from, and how to take it back.
 */
export function renderInheritedWaiverPrompt(
  assessment: HarnessCoverageAssessment,
  originTitle: string,
): string {
  return [
    `Harness coverage for the area this task touches is **${assessment.classification}**.`,
    '',
    assessment.evidence_md.trim(),
    '',
    `This repository's coverage gap was already accepted while running "${originTitle}", so this task inherits that acceptance instead of asking again.`,
    '',
    'Revoke it in Settings to be asked about the next task in this repository.',
  ].join('\n')
}
