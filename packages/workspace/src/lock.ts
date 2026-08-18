import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class LockTimeoutError extends Error {
  constructor(path: string, waitedMs: number) {
    super(`timed out after ${waitedMs}ms waiting for the workspace lock at ${path}`)
    this.name = 'LockTimeoutError'
  }
}

export interface DiskLockOptions {
  readonly heartbeatMs: number
  readonly staleMs: number
  readonly waitMs: number
}

const inflight = new Map<string, Promise<unknown>>()

/**
 * Serializes by key inside this process. The disk lock below is the
 * cross-process guarantee; this one keeps our own concurrent tasks from
 * queueing on the filesystem for no reason.
 */
export function withKeyedMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = inflight.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  inflight.set(key, settled)
  void settled.then(() => {
    if (inflight.get(key) === settled) inflight.delete(key)
  })
  return run
}

interface Holder {
  token: string
  pid: number
  startedAt: string
}

/**
 * `mkdir` is the whole mutual-exclusion primitive: it either creates or fails.
 * The holder keeps the lock's timestamp fresh while it works, so a waiter can
 * tell a slow clone of a large repository from a process that died — a plain
 * deadline cannot, and would let a second clone start on top of a live one.
 */
export async function withDiskLock<T>(
  lockPath: string,
  options: DiskLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const holderPath = join(lockPath, 'holder.json')
  const token = randomUUID()
  const deadline = Date.now() + options.waitMs
  const pollMs = Math.max(50, Math.min(200, Math.floor(options.heartbeatMs / 2)))

  await mkdir(dirname(lockPath), { recursive: true })

  for (;;) {
    try {
      await mkdir(lockPath)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      if (await isAbandoned(lockPath, holderPath, options.staleMs)) {
        await rm(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, options.waitMs)
      await Bun.sleep(pollMs)
    }
  }

  const holder: Holder = { token, pid: process.pid, startedAt: new Date().toISOString() }
  await writeFile(holderPath, JSON.stringify(holder))

  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(holderPath, now, now).catch(() => {})
  }, options.heartbeatMs)
  heartbeat.unref?.()

  try {
    return await fn()
  } finally {
    clearInterval(heartbeat)
    // Only ours to remove: a takeover means someone else owns this directory now.
    const current = await readHolder(holderPath)
    if (!current || current.token === token) {
      await rm(lockPath, { recursive: true, force: true })
    }
  }
}

/** Composes the in-process and cross-process locks every mirror-touching operation shares. */
export function withMirrorLock<T>(
  mirror: string,
  options: DiskLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return withKeyedMutex(mirror, () => withDiskLock(`${mirror}.lock`, options, fn))
}

async function readHolder(holderPath: string): Promise<Holder | null> {
  try {
    return JSON.parse(await readFile(holderPath, 'utf8')) as Holder
  } catch {
    return null
  }
}

async function isAbandoned(
  lockPath: string,
  holderPath: string,
  staleMs: number,
): Promise<boolean> {
  // Falls back to the directory itself for the window between mkdir and the
  // holder file being written.
  const entry = await stat(holderPath).catch(() => stat(lockPath).catch(() => null))
  if (!entry) return true
  return Date.now() - entry.mtimeMs > staleMs
}
