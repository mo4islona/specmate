import { z } from 'zod'
import { CONVERSATION_ACTION_KINDS } from './conversations.ts'
import { AgentRole, ArtifactKind, ROLE_CONTRACTS } from './roles.ts'
import { TaskState } from './state.ts'

/**
 * RESULT.json — the only structured channel out of an agent run. A stage that
 * does not leave a valid RESULT.json at the workspace root gets one retry, then
 * fails into an escalation (§4).
 */
export const RESULT_FILENAME = 'RESULT.json'

export const DecisionKind = z.enum(['question', 'escalation', 'rework', 'approval'])
export type DecisionKind = z.infer<typeof DecisionKind>

export const DecisionRequest = z.object({
  /** Stable within a stage; used to detect the same question being re-asked. */
  key: z.string().min(1).max(128),
  kind: DecisionKind.default('question'),
  prompt_md: z.string().min(1),
  options: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  blocking: z.boolean().default(true),
})
export type DecisionRequest = z.infer<typeof DecisionRequest>

export const ArtifactChange = z.object({
  /** Repo-relative path, e.g. openspec/changes/add-dark-mode/proposal.md */
  path: z.string().min(1),
  kind: ArtifactKind,
  op: z.enum(['created', 'modified', 'deleted']),
})
export type ArtifactChange = z.infer<typeof ArtifactChange>

export const ReviewVerdict = z.enum(['approve', 'revise', 'escalate'])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const ReviewFinding = z.object({
  /** Stable across rounds — repetition of the same id twice triggers escalation (§5). */
  id: z.string().min(1).max(64),
  severity: z.enum(['blocking', 'major', 'minor', 'nit']),
  title: z.string().min(1),
  detail_md: z.string().default(''),
})
export type ReviewFinding = z.infer<typeof ReviewFinding>

/** A finding list as markdown bullets, one line per array entry — shared by the decision log and the runner's ledger, each with its own header and empty-state text. */
export function renderFindingBullets(
  findings: readonly ReviewFinding[],
  text: { header: string; empty: string },
): string[] {
  if (findings.length === 0) return [text.empty]

  return [
    text.header,
    '',
    ...findings.map(
      (finding) =>
        `- \`${finding.id}\` (${finding.severity}) ${finding.title}${
          finding.detail_md ? ` — ${finding.detail_md}` : ''
        }`,
    ),
  ]
}

export const StageResult = z.object({
  schema_version: z.literal(1),
  role: AgentRole,
  status: z.enum(['ok', 'needs_decision', 'failed']),
  artifacts_changed: z.array(ArtifactChange).default([]),
  decisions_needed: z.array(DecisionRequest).default([]),
  /** Required from review-shaped stages (reviewer, verifier): it drives the loop edge. */
  verdict: ReviewVerdict.optional(),
  findings: z.array(ReviewFinding).default([]),
  /** Short human-facing note rendered in the chat timeline. */
  notes_md: z.string().default(''),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cost_usd: z.number().nonnegative().optional(),
    })
    .default({}),
})
export type StageResult = z.infer<typeof StageResult>

export const ConversationActionProposal = z.object({
  kind: z.enum(CONVERSATION_ACTION_KINDS),
  target: z.object({
    taskId: z.string().min(1),
    graphId: z.string().min(1).optional(),
    nodeKey: z.string().min(1).optional(),
    stageId: z.string().min(1).optional(),
    decisionId: z.string().min(1).optional(),
    gate: z.string().min(1).optional(),
  }),
  instruction: z.string().trim().min(1).optional(),
  expectedVersion: z.object({
    taskStatus: TaskState,
    graphId: z.string().min(1).optional(),
    stageId: z.string().min(1).optional(),
    attempt: z.number().int().nonnegative().optional(),
    decisionStatus: z.enum(['open', 'answered', 'dismissed']).optional(),
  }),
})
export type ConversationActionProposal = z.infer<typeof ConversationActionProposal>

export const ConversationResult = z.object({
  message_md: z.string().trim().min(1),
  actions: z.array(ConversationActionProposal).default([]),
  provider_session: z.record(z.string(), z.unknown()).nullable().optional(),
})
export type ConversationResult = z.infer<typeof ConversationResult>

export type ParsedResult =
  | { ok: true; value: StageResult }
  | { ok: false; error: string; raw: string }

export function parseStageResult(raw: string): ParsedResult {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}`, raw }
  }
  const parsed = StageResult.safeParse(json)
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error), raw }

  const verdictError = checkVerdictPresent(parsed.data)
  if (verdictError) return { ok: false, error: verdictError, raw }

  const decisionsError = checkDecisionsPresent(parsed.data)
  if (decisionsError) return { ok: false, error: decisionsError, raw }

  return { ok: true, value: parsed.data }
}

/**
 * REQ-6: silence is not approval — a role whose contract requires a verdict
 * never gets to skip it. Checkable immediately after parse: unlike findings,
 * a verdict is never derived after the fact.
 */
export function checkVerdictPresent(result: StageResult): string | null {
  if (!ROLE_CONTRACTS[result.role].returnsVerdict) return null
  if (result.verdict) return null

  return `${result.role} must return a verdict`
}

/**
 * `advance()` parks on a blocking decision, not on this status alone; but a
 * `needs_decision` status with nothing in `decisions_needed` would still
 * leave the agent's own signal unexplained, so it is rejected at parse time.
 */
export function checkDecisionsPresent(result: StageResult): string | null {
  if (result.status !== 'needs_decision') return null
  if (result.decisions_needed.length > 0) return null

  return `${result.role} returned needs_decision with no decisions_needed`
}

/**
 * REQ-6: a revise with nothing to act on gives the next round no direction.
 * For a corroborated role (verifier), pass the finding set as it stands after
 * scenario-finding derivation — its own returned findings may be empty and
 * still be honest, if the derived findings carry the reason.
 */
export function checkReviseHasFindings(
  result: StageResult,
  findings: readonly ReviewFinding[] = result.findings,
): string | null {
  if (result.verdict !== 'revise') return null
  if (findings.length > 0) return null

  return `${result.role} returned revise with no findings`
}
