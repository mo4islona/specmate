import { afterEach, describe, expect, test } from 'bun:test'
import { ownerFetch, ownerHeaders } from './api-client.ts'
import { clearSecret, getSecret, setSecret } from './secret-store.ts'

afterEach(() => clearSecret())

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
