import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkReviseHasFindings,
  corroborate,
  deriveFindings,
  extractScenarioInventory,
  parseMatrix,
  type ReviewFinding,
  ROLE_CONTRACTS,
  type StageResult,
} from '@specmate/core'
import type { Workspace } from '@specmate/workspace'

export type CorroborationOutcome =
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'ok'; readonly findings: readonly ReviewFinding[] }
  | { readonly kind: 'uncorroborated'; readonly violations: readonly string[] }
  | { readonly kind: 'invalid'; readonly detail: string }

/**
 * REQ-3, REQ-4: cross-checks a corroborated role's report against the change
 * folder's specs, as the run left them — no agent judgment involved. Reads
 * the committed evidence itself; which roles this applies to is a role-
 * contract declaration, so a caller never has to branch on role identity.
 */
export async function corroborateVerification(
  workspace: Workspace,
  result: StageResult,
): Promise<CorroborationOutcome> {
  if (!ROLE_CONTRACTS[result.role].corroborated) return { kind: 'not_applicable' }

  const verdict = result.verdict
  if (!verdict) {
    return { kind: 'invalid', detail: `${result.role} result carries no verdict to corroborate` }
  }

  const inventory = extractScenarioInventory(await readSpecFiles(workspace))
  const report = await readFile(
    join(workspace.path, workspace.changeDir, 'verification.md'),
    'utf8',
  ).catch(() => null)
  if (report === null) {
    return { kind: 'invalid', detail: 'verification.md was not found in the change folder' }
  }

  const matrix = parseMatrix(report)
  if (!matrix.ok) return { kind: 'invalid', detail: matrix.error }

  const check = corroborate(inventory, matrix.rows, verdict)
  if (!check.ok) return { kind: 'uncorroborated', violations: check.violations }

  const findings = deriveFindings(inventory, matrix.rows, result.findings)
  const findingsError = checkReviseHasFindings(result, findings)
  if (findingsError) return { kind: 'invalid', detail: findingsError }

  return { kind: 'ok', findings }
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
