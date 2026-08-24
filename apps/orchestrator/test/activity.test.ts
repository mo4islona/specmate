import { describe, expect, it } from 'bun:test'
import type { StageActivityEvent } from '@specmate/runner'
import { stageActivityPayload } from '../src/activity.ts'

function activity(overrides: Partial<StageActivityEvent> = {}): StageActivityEvent {
  return {
    taskId: 'task-1',
    stageId: 'stage-1',
    attempt: 2,
    tool: 'Read',
    target: 'src/a.ts',
    ...overrides,
  }
}

describe('stage.activity payload (REQ-212)', () => {
  it('an ordinary tool use carries the attempt, the tool and its target', () => {
    expect(stageActivityPayload(activity())).toEqual({
      attempt: 2,
      tool: 'Read',
      target: 'src/a.ts',
    })
  })

  it('an edit travels with the event that reported it — AC-237', () => {
    const edit = {
      path: 'src/a.ts',
      additions: 3,
      deletions: 1,
      preview: '@@ -1,1 +1,3 @@\n-a\n+A',
      patch: '@@ -1,1 +1,3 @@\n-a\n+A\n+B\n+C',
      clamped: true,
      truncated: false,
      anchored: true,
    }

    expect(stageActivityPayload(activity({ tool: 'Edit', edit }))).toMatchObject({
      tool: 'Edit',
      edit,
    })
  })

  it('a tool use with no edit says nothing about one', () => {
    expect(stageActivityPayload(activity())).not.toHaveProperty('edit')
  })
})
