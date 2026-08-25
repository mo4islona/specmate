import {
  type AgentRole,
  checkBrief,
  type HarnessStatus,
  ROLE_CONTRACTS,
  type SpecConvention,
  specSuiteInForce,
} from '@specmate/core'
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
  /** The task's recorded coverage at dispatch time; absent roles need not supply one. */
  harnessStatus: HarnessStatus = 'adequate',
  /**
   * The repository's convention at dispatch time. Undetermined is read as a suite being
   * in force: the brief owes an acceptance list only where it is known there is nothing
   * to specify against, and failing an attempt over a fact nobody resolved is not that.
   */
  specConvention: SpecConvention | null = null,
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

  const acceptanceRequired = specSuiteInForce(specConvention) === false
  const check = checkBrief(
    proposal.content,
    config.briefBytesLimit,
    harnessStatus,
    acceptanceRequired,
  )
  if (check.ok) return { kind: 'ok' }

  const problems = [
    ...check.missing.map((heading) => `missing "${heading}"`),
    ...(check.bytes > check.ceilingBytes
      ? [`${check.bytes} bytes exceeds the ${check.ceilingBytes}-byte ceiling`]
      : []),
    ...(check.coverageUnknown ? ['harness coverage is not yet classified'] : []),
    ...(check.coverageWarningMissing
      ? [`coverage is ${harnessStatus} but Key Points carries no "Harness gap" warning`]
      : []),
    ...(check.acceptanceMissing
      ? ['the repository has no specification suite and the brief declares no acceptance scenario']
      : []),
    ...(check.acceptanceUnexpected
      ? ['the repository has a specification suite, which is what declares the scenarios']
      : []),
  ]

  return { kind: 'incomplete', detail: `brief is incomplete: ${problems.join(', ')}` }
}
