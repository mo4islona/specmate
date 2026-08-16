import { describe, expect, test } from 'bun:test'
import type { TaskSummary } from '../lib/api-client.ts'
import { taskGroup } from './task-navigation.tsx'

function task(id: string, status: TaskSummary['status']): TaskSummary {
  return { id, status } as TaskSummary
}

describe('taskGroup', () => {
  test('pins every attention task before status-based groups', () => {
    const attention = new Set(['failed-task', 'stalled-task'])

    expect(taskGroup(task('failed-task', 'failed'), attention)).toBe('Needs input')
    expect(taskGroup(task('stalled-task', 'implement'), attention)).toBe('Needs input')
    expect(taskGroup(task('active-task', 'implement'), attention)).toBe('Active')
    expect(taskGroup(task('done-task', 'archived'), attention)).toBe('Complete')
  })
})
