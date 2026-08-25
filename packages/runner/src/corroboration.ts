import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  briefAcceptanceSource,
  checkReviseHasFindings,
  corroborate,
  deriveFindings,
  extractScenarioInventory,
  parseMatrix,
  type ReviewFinding,
  ROLE_CONTRACTS,
  type SpecConvention,
  type StageResult,
  specSuiteInForce,
} from '@specmate/core'
import type { Workspace } from '@specmate/workspace'
import { readChangeFile } from './change-file.ts'

export type CorroborationOutcome =
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'ok'; readonly findings: readonly ReviewFinding[] }
  | { readonly kind: 'uncorroborated'; readonly violations: readonly string[] }
  | { readonly kind: 'invalid'; readonly detail: string }

/**
 * REQ-3, REQ-4: cross-checks a corroborated role's report against the change's
 * acceptance source, as the run left it — no agent judgment involved. Reads
 * the committed evidence itself; which roles this applies to is a role-
 * contract declaration, so a caller never has to branch on role identity.
 */
export async function corroborateVerification(
  workspace: Workspace,
  result: StageResult,
  /** Which source declares the scenarios. Undetermined reads as a suite, the older path. */
  specConvention: SpecConvention | null = null,
): Promise<CorroborationOutcome> {
  if (!ROLE_CONTRACTS[result.role].corroborated) return { kind: 'not_applicable' }

  const verdict = result.verdict
  if (!verdict) {
    return { kind: 'invalid', detail: `${result.role} result carries no verdict to corroborate` }
  }

  const source = await acceptanceSource(workspace, specConvention)
  const inventory = extractScenarioInventory(source.documents)

  // REQ-1103. Every scenario passing is a guarantee only where there is a scenario; over
  // an empty inventory the same test is vacuous, and a verdict nothing can contradict is
  // not a corroborated one.
  if (verdict === 'approve' && inventory.length === 0) {
    return {
      kind: 'invalid',
      detail: `${source.label} declares no scenario, so an approve corroborates nothing`,
    }
  }

  const report = await readChangeFile(workspace, 'verification.md')
  if (report.content === null) {
    return { kind: 'invalid', detail: report.detail }
  }

  const matrix = parseMatrix(report.content)
  if (!matrix.ok) return { kind: 'invalid', detail: matrix.error }

  const check = corroborate(inventory, matrix.rows, verdict)
  if (!check.ok) return { kind: 'uncorroborated', violations: check.violations }

  const findings = deriveFindings(inventory, matrix.rows, result.findings)
  const findingsError = checkReviseHasFindings(result, findings)
  if (findingsError) return { kind: 'invalid', detail: findingsError }

  return { kind: 'ok', findings }
}

interface AcceptanceSource {
  readonly label: string
  readonly documents: readonly string[]
}

/**
 * The change's specs where a specifying stage ran, the kickoff brief's acceptance list
 * where none did (REQ-1102, REQ-1706). Which one is in force follows from the profile the
 * task ran under, never from what the change folder happens to contain — a leftover file
 * must not be able to decide what an approve is held to.
 */
async function acceptanceSource(
  workspace: Workspace,
  specConvention: SpecConvention | null,
): Promise<AcceptanceSource> {
  if (specSuiteInForce(specConvention) !== false) {
    return { label: "the change's specs", documents: await readSpecFiles(workspace) }
  }

  const proposal = await readChangeFile(workspace, 'proposal.md')

  return {
    label: "the brief's acceptance list",
    documents: proposal.content === null ? [] : [briefAcceptanceSource(proposal.content)],
  }
}

async function readSpecFiles(workspace: Workspace): Promise<string[]> {
  const specsDir = join(workspace.path, workspace.changeDir, 'specs')
  const paths = await walkMarkdown(specsDir)

  return Promise.all(paths.map((path) => readFile(path, 'utf8')))
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full)))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }

  return files
}
