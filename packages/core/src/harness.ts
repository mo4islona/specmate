import { z } from 'zod'

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

/** The Key Points bullet label `checkBrief` looks for and `roles/planner.md` writes. */
export const HARNESS_GAP_LABEL = 'Harness gap'

/** The engine-raised coverage decision's prompt — the evidence, stated plainly, ahead of the three-way choice. */
export function renderHarnessGapPrompt(assessment: HarnessCoverageAssessment): string {
  return [
    `Harness coverage for the area this task touches is **${assessment.classification}**.`,
    '',
    assessment.evidence_md.trim(),
    '',
    'The result cannot be properly validated without addressing this. Choose how to proceed:',
    '- Build the harness first, as a separate task this one waits on.',
    '- Proceed, accepting that the work cannot be properly validated.',
    '- Cancel this task.',
  ].join('\n')
}
