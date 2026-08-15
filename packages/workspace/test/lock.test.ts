import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LockTimeoutError, withDiskLock, withKeyedMutex } from '../src/index.ts'
import { cleanupTempDirs, FAST_LOCKS, tempDir } from './fixtures.ts'

const options = {
  heartbeatMs: FAST_LOCKS.lockHeartbeatMs,
  staleMs: FAST_LOCKS.lockStaleMs,
  waitMs: 5_000,
}

afterAll(cleanupTempDirs)

describe('disk lock', () => {
  test('serializes concurrent holders', async () => {
    const lock = join(await tempDir('lock'), 'mirror.lock')
    const order: string[] = []
    const hold = (name: string) =>
      withDiskLock(lock, options, async () => {
        order.push(`${name}:enter`)
        await Bun.sleep(80)
        order.push(`${name}:exit`)
      })

    await Promise.all([hold('a'), hold('b')])

    expect(order).toHaveLength(4)
    expect(order[1]).toBe(order[0]?.replace(':enter', ':exit'))
    expect(order[3]).toBe(order[2]?.replace(':enter', ':exit'))
  })

  test('does not take over a slow but living holder', async () => {
    const lock = join(await tempDir('lock'), 'mirror.lock')
    // Four times the stale window: a deadline-based lock would have handed this
    // one away half-way through, which is exactly the first-clone case.
    const holdMs = options.staleMs * 4
    let holderDone = false
    let waiterEnteredEarly = false

    const holder = withDiskLock(lock, options, async () => {
      await Bun.sleep(holdMs)
      holderDone = true
    })
    await Bun.sleep(20)
    const waiter = withDiskLock(lock, options, async () => {
      waiterEnteredEarly = !holderDone
    })

    await Promise.all([holder, waiter])
    expect(waiterEnteredEarly).toBe(false)
  })

  test('takes over a lock whose holder stopped breathing', async () => {
    const lock = join(await tempDir('lock'), 'mirror.lock')
    await mkdir(lock, { recursive: true })
    await writeFile(join(lock, 'holder.json'), JSON.stringify({ token: 'dead', pid: 1 }))
    const past = new Date(Date.now() - options.staleMs * 10)
    await utimes(join(lock, 'holder.json'), past, past)

    let entered = false
    await withDiskLock(lock, options, async () => {
      entered = true
    })
    expect(entered).toBe(true)
  })

  test('a waiter that runs out of patience fails instead of proceeding', async () => {
    const lock = join(await tempDir('lock'), 'mirror.lock')
    const holder = withDiskLock(lock, options, () => Bun.sleep(options.staleMs * 4))
    await Bun.sleep(20)

    await expect(
      withDiskLock(lock, { ...options, waitMs: options.staleMs }, async () => 'never'),
    ).rejects.toThrow(LockTimeoutError)
    await holder
  })
})

describe('keyed mutex', () => {
  test('serializes by key and lets other keys through', async () => {
    const order: string[] = []
    const run = (key: string, name: string) =>
      withKeyedMutex(key, async () => {
        order.push(`${name}:enter`)
        await Bun.sleep(30)
        order.push(`${name}:exit`)
      })

    await Promise.all([run('a', 'a1'), run('a', 'a2'), run('b', 'b1')])

    expect(order.indexOf('a1:exit')).toBeLessThan(order.indexOf('a2:enter'))
    expect(order).toContain('b1:exit')
  })

  test('a failing holder does not wedge the key', async () => {
    await expect(
      withKeyedMutex('boom', async () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    await expect(withKeyedMutex('boom', async () => 'fine')).resolves.toBe('fine')
  })
})
