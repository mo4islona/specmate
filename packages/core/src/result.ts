import { z } from 'zod'
import { AgentRole, ArtifactKind } from './roles.ts'

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

export const StageResult = z.object({
  schema_version: z.literal(1),
  role: AgentRole,
  status: z.enum(['ok', 'needs_decision', 'failed']),
  artifacts_changed: z.array(ArtifactChange).default([]),
  decisions_needed: z.array(DecisionRequest).default([]),
  /** Reviewer-only. */
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
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error), raw }
}
