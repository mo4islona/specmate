import { HARNESS_GAP_LABEL, type HarnessStatus, needsCoverageWarning } from './harness.ts'

/**
 * The kickoff brief's required parts (REQ-1302), as the exact H2 headings the
 * check looks for. `roles/planner.md` names these same headings so a planner
 * run and this check never drift apart.
 */
export const BRIEF_SECTIONS = [
  'What and Why',
  'Approach',
  'Key Points',
  'Open Questions',
  'Size',
] as const

/** The section the UI accents, named from `BRIEF_SECTIONS` so a rename here propagates automatically. */
export const BRIEF_ACCENT_HEADING = BRIEF_SECTIONS[2]

export const DEFAULT_BRIEF_CEILING_BYTES = 6_000

export interface BriefCheckResult {
  readonly ok: boolean
  /** Required parts absent or empty, named as the heading the brief must carry. */
  readonly missing: readonly string[]
  readonly bytes: number
  readonly ceilingBytes: number
  /** REQ-1402, AC-1406: coverage had not been classified when this brief was checked. */
  readonly coverageUnknown: boolean
  /** REQ-1402, AC-1404: coverage is short of adequate and Key Points carries no gap warning. */
  readonly coverageWarningMissing: boolean
}

/**
 * Textual and dumb on purpose (REQ-1303): presence, non-empty content, and
 * length only, with no agent judgment involved. Whether the brief persuades
 * is the gate's call, never this check's. `coverage` extends that same
 * posture (REQ-1402): a fixed Key Points label, checked the same textual way
 * as the five required headings — never a judgment on whether the warning is
 * any good.
 */
export function checkBrief(
  markdown: string,
  ceilingBytes: number = DEFAULT_BRIEF_CEILING_BYTES,
  coverage: HarnessStatus = 'adequate',
): BriefCheckResult {
  // A Map keyed by heading would let a repeated heading's last occurrence hide
  // an earlier one's real content, so bodies are collected per heading instead.
  const bodiesByHeading = new Map<string, string[]>()
  for (const section of splitBriefSections(markdown)) {
    const key = normalizeBriefHeading(section.heading)
    const bodies = bodiesByHeading.get(key) ?? []
    bodies.push(section.body)
    bodiesByHeading.set(key, bodies)
  }

  const missing = BRIEF_SECTIONS.filter((heading) => {
    const bodies = bodiesByHeading.get(normalizeBriefHeading(heading)) ?? []
    return !bodies.some((body) => body.trim())
  })
  const bytes = Buffer.byteLength(markdown, 'utf8')

  const coverageUnknown = coverage === 'unknown'
  const coverageWarningMissing =
    !coverageUnknown &&
    needsCoverageWarning(coverage) &&
    !hasHarnessGapWarning(bodiesByHeading.get(normalizeBriefHeading('Key Points')) ?? [])

  const ok =
    missing.length === 0 && bytes <= ceilingBytes && !coverageUnknown && !coverageWarningMissing

  return { ok, missing, bytes, ceilingBytes, coverageUnknown, coverageWarningMissing }
}

/** A `- Harness gap: …` bullet anywhere in the Key Points section, case-insensitive and however indented. */
function hasHarnessGapWarning(keyPointsBodies: readonly string[]): boolean {
  const pattern = new RegExp(`^\\s*-\\s*${HARNESS_GAP_LABEL}\\s*:`, 'im')

  return keyPointsBodies.some((body) => pattern.test(body))
}

export interface BriefSection {
  readonly heading: string
  readonly body: string
}

/** Every `##` section in document order, heading text as written — shared with the brief's rendering. */
export function splitBriefSections(markdown: string): readonly BriefSection[] {
  const sections: BriefSection[] = []
  let heading: string | null = null
  let buffer: string[] = []
  let preamble = ''

  const flush = () => {
    const body = buffer.join('\n').trim()
    if (heading !== null) sections.push({ heading, body })
    else preamble = body
  }

  for (const line of markdown.split('\n')) {
    const match = /^##\s+(\S.*?)\s*$/.exec(line)
    if (match?.[1]) {
      flush()
      heading = match[1].trim()
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  flush()

  // Text before the first heading is kept alongside real sections — never
  // hidden — but a document with no `##` heading at all is not a brief, and
  // callers fall back to rendering it raw rather than as one untitled section.
  if (preamble && sections.length > 0) return [{ heading: '', body: preamble }, ...sections]

  return sections
}

/** Exported so a renderer can match a heading the same way the check does. */
export function normalizeBriefHeading(heading: string): string {
  return collapseWhitespace(heading.toLowerCase())
}

/** Runs of whitespace collapsed to one space, ends trimmed — shared by anything rendering free text into one line. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
