import { describe, expect, test } from 'bun:test'
import type { CreateTaskInput } from '../lib/api-client.ts'
import { buildCreateTaskPayload } from './new-task-screen.tsx'

const BASE: CreateTaskInput = {
  title: 'Fix the reorg bug',
  description: '',
  type: 'bugfix',
  repoUrl: 'https://github.com/example/repo',
  baseBranch: 'main',
}

describe('buildCreateTaskPayload', () => {
  test('a multi-paragraph request reaches the payload intact', () => {
    const request = 'Reorgs deeper than 6 blocks corrupt the balance index.\n\nFix the ingester.'

    const payload = buildCreateTaskPayload({ ...BASE, description: request })

    expect(payload.description).toBe(request)
  })

  test('a blank request reaches the payload as absent, not as an empty string', () => {
    const payload = buildCreateTaskPayload({ ...BASE, description: '   ' })

    expect(payload.description).toBeUndefined()
  })

  test('every other field passes through unchanged', () => {
    const payload = buildCreateTaskPayload(BASE)

    expect(payload).toMatchObject({
      title: BASE.title,
      type: BASE.type,
      repoUrl: BASE.repoUrl,
      baseBranch: BASE.baseBranch,
    })
  })
})
