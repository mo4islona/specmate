import type { StageActivityEvent } from '@specmate/runner'

/**
 * What a `stage.activity` event carries (REQ-212). The edit is nested rather
 * than spread: the timeline read drops the whole patch by path, and a nested
 * path is one operation instead of a rebuilt object.
 */
export function stageActivityPayload(activity: StageActivityEvent): Record<string, unknown> {
  return {
    attempt: activity.attempt,
    tool: activity.tool,
    target: activity.target,
    ...(activity.edit ? { edit: activity.edit } : {}),
  }
}
