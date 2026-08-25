import type { Stage } from '@specmate/db'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  )

  return Object.fromEntries(entries)
}

export function serializeStage(stage: Stage) {
  const usage: Record<string, unknown> = isRecord(stage.cost) ? stage.cost : {}
  const model = typeof usage.model === 'string' ? usage.model : null
  const tokens = numberRecord(usage.tokens)
  const costUsd = typeof usage.costUsd === 'number' ? usage.costUsd : null
  const hasTelemetry = model !== null || tokens !== null || costUsd !== null

  return {
    id: stage.id,
    taskId: stage.taskId,
    graphId: stage.graphId,
    nodeKey: stage.nodeKey,
    role: stage.role,
    provider: stage.provider,
    status: stage.status,
    attempt: stage.attempt,
    skillSha: stage.skillSha,
    result: stage.result,
    acceptedCommit: stage.acceptedCommit,
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt,
    interruptionCleanupStatus: stage.interruptionCleanupStatus,
    interruptionFailure: stage.interruptionFailure,
    skipReason: stage.skipReason,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
    telemetry: hasTelemetry
      ? {
          model,
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt,
          tokens,
          costUsd,
        }
      : null,
  }
}
