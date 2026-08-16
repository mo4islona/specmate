import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const INDEX = join(import.meta.dir, '../src/index.ts')

async function startWith(
  env: Record<string, string>,
): Promise<{ exitCode: number; stderr: string }> {
  const child = Bun.spawn(['bun', INDEX], {
    env: { PATH: process.env.PATH ?? '', DATABASE_URL: 'postgres://unused', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await child.exited
  const stderr = await new Response(child.stderr).text()

  return { exitCode, stderr }
}

// Settings are validated before anything else runs, so a bad value is a fast
// startup failure naming the variable, not a stuck loop later.
describe('orchestrator settings', () => {
  test('an invalid attempt cap exits non-zero naming the variable', async () => {
    const { exitCode, stderr } = await startWith({ STAGE_ATTEMPT_CAP: '0' })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('STAGE_ATTEMPT_CAP')
  })

  test('an invalid concurrency exits non-zero naming the variable', async () => {
    const { exitCode, stderr } = await startWith({ STAGE_CONCURRENCY: 'many' })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('STAGE_CONCURRENCY')
  })

  test('an invalid poll interval exits non-zero naming the variable', async () => {
    const { exitCode, stderr } = await startWith({ TICK_INTERVAL_MS: '-5' })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('TICK_INTERVAL_MS')
  })
})
