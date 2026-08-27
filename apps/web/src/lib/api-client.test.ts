import { afterEach, describe, expect, test, vi } from 'vitest'
import { deleteTask, ownerFetch, ownerHeaders } from './api-client.ts'
import { clearSecret, getSecret, setSecret } from './secret-store.ts'

afterEach(() => {
  clearSecret()
  vi.unstubAllGlobals()
})

describe('owner authentication', () => {
  test('attaches the stored secret as a bearer header', () => {
    setSecret('owner-secret')

    expect(ownerHeaders()).toEqual({ authorization: 'Bearer owner-secret' })
  })

  test('clears a rejected secret so the gate prompts again', async () => {
    setSecret('wrong-secret')

    await ownerFetch('/api/v1/tasks', undefined, async () => new Response(null, { status: 401 }))

    expect(getSecret()).toBeNull()
  })
})

describe('task deletion', () => {
  test('sends one typed delete request and accepts an empty success response', async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', request)

    await deleteTask('task-1')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0].toString()).toContain('/api/v1/tasks/task-1')
    expect(request.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })

  test('keeps the structured rejection from a task that moved under the request', async () => {
    const detail = 'task task-1 left implement while implement → cancelled was in flight'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ code: 'conflict', detail }, { status: 409 })),
    )

    await expect(deleteTask('task-1')).rejects.toEqual(
      expect.objectContaining({ status: 409, code: 'conflict', message: detail }),
    )
  })
})
