import type { ArtifactKind } from '@specmate/core'
import type { ArtifactSummary } from './api-client.ts'
import type { PipelineNodeView } from './task-pipeline.ts'

interface DocumentsInput {
  readonly artifacts: readonly ArtifactSummary[]
  /** The step being read. */
  readonly step: PipelineNodeView | null
  readonly nodes: readonly PipelineNodeView[]
}

function millis(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()

  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Which step's runs wrote the documents this one is about. A gate writes
 * nothing and exists to judge what came before it, so it shows that step's
 * output — the whole point of the stop is reading the document it is gating.
 */
function producingStep(
  step: PipelineNodeView | null,
  nodes: readonly PipelineNodeView[],
): PipelineNodeView | null {
  if (!step) return null
  if (step.runs.length > 0) return step

  if (step.kind !== 'gate') return null

  const at = nodes.findIndex((node) => node.key === step.key)

  for (let index = at - 1; index >= 0; index -= 1) {
    const earlier = nodes[index]
    if (earlier && earlier.runs.length > 0) return earlier
  }

  return null
}

/**
 * The documents a step produced. Artifacts carry no node of their own, so the
 * claim is made from when they were last written: a document rewritten inside
 * one of this step's runs is this step's output, and a document a later stage
 * rewrote belongs to that stage instead — which is what "the final document at
 * this step" has to mean for it to stay true as the task walks on.
 */
export function stepDocuments({ artifacts, step, nodes }: DocumentsInput): ArtifactSummary[] {
  const producer = producingStep(step, nodes)
  if (!producer) return []

  const windows = producer.runs
    .map((run) => ({ from: millis(run.startedAt), to: millis(run.finishedAt) ?? Number.MAX_VALUE }))
    .filter((window): window is { from: number; to: number } => window.from !== null)

  return artifacts.filter((artifact) => {
    const written = millis(artifact.updatedAt)
    if (written === null) return false

    return windows.some((window) => written >= window.from && written <= window.to)
  })
}

/**
 * What this app calls each document.
 *
 * The name is the pipeline's, not the file's. A repository's spec convention
 * decides how its files are laid out and named — OpenSpec is one of several,
 * and `kind` is the vocabulary every one of them is mapped onto — so a list
 * built on file names says `review.md` under a convention that spells it some
 * other way, and says nothing at all under one that does not use `.md`.
 */
const NAMES: Readonly<Record<ArtifactKind, string>> = {
  proposal: 'Proposal',
  design: 'Design',
  spec: 'Specification',
  tasks: 'Tasks',
  review: 'Review',
  verification: 'Verification',
  summary: 'Summary',
  decision_log: 'Decision log',
}

/**
 * The order they read in: the proposal states the change and the decision log
 * carries what the owner settled about it, the design and the specs plan it,
 * the reviews judge it, the summary closes it. The catalogue in `@specmate/core`
 * is a set and sorts by nothing in particular, so the sequence is spelled here.
 *
 * The decision log is second rather than last because it is not a stage's
 * output at all — no role writes it, the store renders it before every dispatch
 * — so it has no place in the sequence of things written. It is the owner's
 * half of the contract, and everything below it is bound by it. Sorted by when
 * it was last touched it landed after the summary, behind the document whose
 * whole job is to be the end.
 */
const READING_ORDER: readonly ArtifactKind[] = [
  'proposal',
  'decision_log',
  'design',
  'spec',
  'tasks',
  'review',
  'verification',
  'summary',
]

function inReadingOrder(artifacts: readonly ArtifactSummary[]): ArtifactSummary[] {
  const rank = (artifact: ArtifactSummary) => {
    const at = READING_ORDER.indexOf(artifact.kind)

    return at === -1 ? READING_ORDER.length : at
  }

  return [...artifacts].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

/**
 * What the path adds to the kind's own name, or null where it adds nothing.
 *
 * A task holds one of most kinds, and there the path is the name again in a
 * second face — `review.md` under `Review`, and the change folder above it
 * repeated once per row. It holds a specification per capability, and there the
 * capability is the whole of what tells two rows apart: it is the folder the
 * file sits in, every role that writes one writing `specs/<capability>/spec.md`.
 */
function qualifier(document: ArtifactSummary, sameKind: number): string | null {
  const segments = document.path.split('/')
  const stem = segments.at(-1)?.replace(/\.md$/, '') ?? document.path

  if (document.kind === 'spec') {
    const folder = segments.at(-2)

    return folder === undefined || folder === 'specs' ? stem : folder
  }

  // Nothing writes two of any other kind today. A record that holds two is
  // still two rows, and two rows both reading `Review` are one row as far as
  // anyone reading them can tell.
  return sameKind > 1 ? stem : null
}

export interface NamedDocument {
  readonly artifact: ArtifactSummary
  readonly name: string
  readonly qualifier: string | null
}

/**
 * The documents in reading order, each under the name this app gives it: what
 * both the Docs rail and a step's own shelf draw, so the two agree on what a
 * document is called.
 */
export function namedDocuments(artifacts: readonly ArtifactSummary[]): NamedDocument[] {
  const perKind = new Map<ArtifactKind, number>()
  for (const artifact of artifacts) {
    perKind.set(artifact.kind, (perKind.get(artifact.kind) ?? 0) + 1)
  }

  return inReadingOrder(artifacts).map((artifact) => ({
    artifact,
    name: NAMES[artifact.kind],
    qualifier: qualifier(artifact, perKind.get(artifact.kind) ?? 1),
  }))
}
