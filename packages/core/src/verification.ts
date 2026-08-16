import type { ReviewFinding, ReviewVerdict } from './result.ts'

/**
 * Mechanical corroboration of a verifier's report against a change's specs
 * (`verification` capability). Every function here is pure over strings and
 * data already read from disk — no filesystem, no provider, no database — so
 * the caller (the runner's executor) owns all I/O and this module stays
 * exhaustively unit-testable.
 */

const SCENARIO_HEADING = /^####[ \t]+Scenario:[ \t]*(.+?)\s*$/gm

/**
 * Every `#### Scenario:` header across a change's `specs/**\/*.md`, keyed by
 * the text after the "Scenario:" label — the same text a matrix's Scenario
 * column holds. Duplicate text (within one file or across files) collapses
 * to a single scenario, in first-seen order.
 */
export function extractScenarioInventory(specFiles: readonly string[]): string[] {
  const seen = new Set<string>()

  for (const content of specFiles) {
    for (const match of content.matchAll(SCENARIO_HEADING)) {
      const scenario = match[1]
      if (scenario) seen.add(scenario)
    }
  }

  return [...seen]
}

export type MatrixOutcome = 'pass' | 'fail' | 'uncovered'

export interface MatrixRow {
  readonly scenario: string
  readonly assertion: string
  readonly outcome: MatrixOutcome
}

export type ParsedMatrix = { readonly ok: true; readonly rows: readonly MatrixRow[] } | ParseFailure

interface ParseFailure {
  readonly ok: false
  readonly error: string
}

const MATRIX_HEADING = /^##[ \t]+Matrix[ \t]*$/m
const MATRIX_COLUMNS = ['scenario', 'assertion', 'outcome'] as const
const MATRIX_OUTCOMES: ReadonlySet<string> = new Set(['pass', 'fail', 'uncovered'])

/**
 * The table under `verification.md`'s `## Matrix` heading, into rows plain
 * code can cross-check. Tolerant of alignment and column whitespace; strict
 * about the heading and the column set — an unreadable table is a parse
 * failure, not an empty result, so a sloppy report cannot pass by omission.
 */
export function parseMatrix(report: string): ParsedMatrix {
  const heading = MATRIX_HEADING.exec(report)
  if (!heading) return { ok: false, error: 'no "## Matrix" heading found' }

  const tableLines = collectTableLines(report.slice(heading.index + heading[0].length))
  if (tableLines.length < 2) {
    return { ok: false, error: 'no table found under "## Matrix"' }
  }

  const [headerLine, separatorLine, ...dataLines] = tableLines
  const columns = matchColumns(splitRow(headerLine ?? ''))
  if (!columns) {
    return {
      ok: false,
      error: `matrix table columns must be exactly scenario, assertion, outcome — found: ${splitRow(headerLine ?? '').join(', ')}`,
    }
  }

  if (!isSeparatorRow(splitRow(separatorLine ?? ''))) {
    return {
      ok: false,
      error: `matrix table is missing its header separator row: ${separatorLine}`,
    }
  }

  const rows: MatrixRow[] = []
  for (const line of dataLines) {
    const cells = splitRow(line)
    if (cells.length !== columns.width) {
      return {
        ok: false,
        error: `matrix row has ${cells.length} columns, expected ${columns.width}: ${line}`,
      }
    }

    const outcomeRaw = (cells[columns.outcome] ?? '').trim().toLowerCase()
    if (!MATRIX_OUTCOMES.has(outcomeRaw)) {
      return {
        ok: false,
        error: `unrecognized outcome "${cells[columns.outcome]}" in row: ${line}`,
      }
    }

    rows.push({
      scenario: (cells[columns.scenario] ?? '').trim(),
      assertion: (cells[columns.assertion] ?? '').trim(),
      outcome: outcomeRaw as MatrixOutcome,
    })
  }

  return { ok: true, rows }
}

/** Consecutive `|`-led lines right after the heading; a blank line ends the table. */
function collectTableLines(afterHeading: string): string[] {
  const lines: string[] = []
  for (const raw of afterHeading.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) {
      if (lines.length > 0) break

      continue
    }
    if (!line.startsWith('|')) {
      if (lines.length > 0) break

      continue
    }
    lines.push(line)
  }

  return lines
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function matchColumns(header: readonly string[]): {
  readonly scenario: number
  readonly assertion: number
  readonly outcome: number
  readonly width: number
} | null {
  const normalized = header.map((cell) => cell.toLowerCase())
  const isExactSet =
    normalized.length === MATRIX_COLUMNS.length &&
    MATRIX_COLUMNS.every((col) => normalized.includes(col))
  if (!isExactSet) return null

  return {
    scenario: normalized.indexOf('scenario'),
    assertion: normalized.indexOf('assertion'),
    outcome: normalized.indexOf('outcome'),
    width: normalized.length,
  }
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

export interface CorroborationResult {
  readonly ok: boolean
  /** Scenario header text for every violation, in inventory order. */
  readonly violations: readonly string[]
}

/**
 * REQ-3: an approve verdict is accepted only when every declared scenario is
 * covered by at least one executed assertion and every reported outcome for
 * it is a pass. A non-approve verdict is not corroborated — it passes
 * through unchanged, since only "approve" claims the work is done.
 */
export function corroborate(
  inventory: readonly string[],
  matrix: readonly MatrixRow[],
  verdict: ReviewVerdict,
): CorroborationResult {
  if (verdict !== 'approve') return { ok: true, violations: [] }

  const violations = inventory.filter((scenario) => {
    const rows = matrix.filter((row) => row.scenario === scenario)

    return rows.length === 0 || rows.some((row) => row.outcome !== 'pass')
  })

  return { ok: violations.length === 0, violations }
}

/**
 * REQ-4: one finding per failing or uncovered scenario, identifier
 * deterministic from the scenario's identity (its acceptance ID when its
 * header carries one), merged with the agent's own findings — a derived
 * finding wins over an agent finding that reused its identifier, since the
 * derived one is the one backed by evidence.
 */
export function deriveFindings(
  inventory: readonly string[],
  matrix: readonly MatrixRow[],
  agentFindings: readonly ReviewFinding[],
): ReviewFinding[] {
  const derived: ReviewFinding[] = []

  for (const scenario of inventory) {
    const rows = matrix.filter((row) => row.scenario === scenario)
    const failing = rows.some((row) => row.outcome === 'fail')
    const uncovered = rows.length === 0 || rows.some((row) => row.outcome === 'uncovered')
    if (!failing && !uncovered) continue

    derived.push({
      id: scenarioFindingId(scenario),
      severity: 'blocking',
      title: failing ? `Scenario failing: ${scenario}` : `Scenario uncovered: ${scenario}`,
      detail_md: describeScenarioRows(rows),
    })
  }

  const derivedIds = new Set(derived.map((finding) => finding.id))
  const ownFindings = agentFindings.filter((finding) => !derivedIds.has(finding.id))

  return [...derived, ...ownFindings]
}

/** The scenario's acceptance ID when its header carries one, else a stable slug of the text. */
export function scenarioFindingId(scenario: string): string {
  const acceptanceId = scenario.match(/\bAC-\d+\b/)
  if (acceptanceId) return acceptanceId[0]

  return `scenario-${slugify(scenario)}`
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // "scenario-" is 9 chars; ReviewFinding.id caps at 64.
  return slug.slice(0, 55)
}

function describeScenarioRows(rows: readonly MatrixRow[]): string {
  if (rows.length === 0) return 'No assertion in the report covers this scenario.'

  return rows.map((row) => `- \`${row.assertion}\`: ${row.outcome}`).join('\n')
}
