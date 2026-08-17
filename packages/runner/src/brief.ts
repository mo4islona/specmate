import { type AgentRole, checkBrief, ROLE_CONTRACTS } from '@specmate/core'
import type { Workspace } from '@specmate/workspace'
import { readChangeFile } from './change-file.ts'
import type { RunnerConfig } from './config.ts'

export type BriefCompletenessOutcome =
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'incomplete'; readonly detail: string }

/**
 * REQ-1303: after any planner run that wrote the proposal, the brief's
 * required parts are checked mechanically, before anything is committed. A
 * no-op for a role the catalog does not declare, and for a run that left the
 * proposal untouched — the filesystem decides that, the same authority
 * `checkWriteScope` defers to. `role` is the dispatcher-assigned role, not the
 * run's self-reported one — trusting a self-report would let a misreporting
 * run skip this check the same way it would `checkWriteScope`.
 */
export async function checkBriefCompleteness(
  config: RunnerConfig,
  workspace: Workspace,
  role: AgentRole,
  getChangedPaths: () => Promise<readonly string[]>,
): Promise<BriefCompletenessOutcome> {
  if (!ROLE_CONTRACTS[role].checksProposalCompleteness) return { kind: 'not_applicable' }

  const proposalPath = `${workspace.changeDir}/proposal.md`
  if (!(await getChangedPaths()).includes(proposalPath)) {
    return { kind: 'not_applicable' }
  }

  const proposal = await readChangeFile(workspace, 'proposal.md')
  if (proposal.content === null) {
    return { kind: 'incomplete', detail: proposal.detail }
  }

  const check = checkBrief(proposal.content, config.briefBytesLimit)
  if (check.ok) return { kind: 'ok' }

  const problems = [
    ...check.missing.map((heading) => `missing "${heading}"`),
    ...(check.bytes > check.ceilingBytes
      ? [`${check.bytes} bytes exceeds the ${check.ceilingBytes}-byte ceiling`]
      : []),
  ]

  return { kind: 'incomplete', detail: `brief is incomplete: ${problems.join(', ')}` }
}
