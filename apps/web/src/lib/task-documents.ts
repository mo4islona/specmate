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
