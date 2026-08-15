import { afterAll, describe, expect, test } from 'bun:test'
import { ClaudeCodeProvider } from '../src/claude.ts'
import { LocalBackend } from '../src/local-backend.ts'
import { cleanupTempDirs, makeConfig, STUB_ENV, setStubEnv } from './fixtures.ts'

afterAll(cleanupTempDirs)

function provider(mode: string, cli?: string) {
  const config = makeConfig({ forwardEnv: STUB_ENV, ...(cli ? { cli } : {}) })
  setStubEnv({ SPECMATE_STUB_MODE: mode })

  return new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
}

describe('provider healthcheck', () => {
  test('reports a usable session and the CLI version', async () => {
    const status = await provider('ok').healthcheck()

    expect(status.provider).toBe('claude-code')
    expect(status.auth).toBe('ok')
    expect(status.cliVersion).toContain('1.0.0-stub')
  })

  test('says the session expired so tasks can pause instead of failing', async () => {
    const status = await provider('expired').healthcheck()

    expect(status.auth).toBe('expired')
    expect(status.detail).toContain('re-login')
  })

  test('is indeterminate rather than wrong when the check itself fails', async () => {
    const status = await provider('nonzero-exit').healthcheck()

    expect(status.auth).toBe('unknown')
  })

  test('reports unknown when the CLI cannot be run at all', async () => {
    const status = await provider('ok', '/nonexistent/claude').healthcheck()

    expect(status.auth).toBe('unknown')
  })

  test('carries no credential material', async () => {
    const status = await provider('expired').healthcheck()

    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('sk-')
    expect(serialized).not.toContain('Invalid credentials')
  })
})
