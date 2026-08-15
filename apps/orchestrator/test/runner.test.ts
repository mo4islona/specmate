import { describe, expect, test } from 'bun:test'
import { RunnerEnv, runnerConfigFrom, UnsafeBackendError } from '../src/runner.ts'

function env(overrides: Record<string, string> = {}) {
  return RunnerEnv.parse({ RUNNER_BACKEND: 'docker', ...overrides })
}

describe('runner configuration', () => {
  test('refuses to run agents in-process in production', () => {
    expect(() => runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'production')).toThrow(
      UnsafeBackendError,
    )
    expect(() => runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'production')).toThrow(
      /RUNNER_BACKEND/,
    )
  })

  test('allows the in-process backend outside production', () => {
    expect(runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'development').backend).toBe('local')
  })

  test('treats an empty variable as unset rather than invalid', () => {
    const config = runnerConfigFrom(env({ RUNNER_IMAGE: '', RUNNER_MODEL: '' }), 'production')

    expect(config.image).toBe('specmate/runner-claude:latest')
    expect(config.model).toBe('claude-opus-5')
  })

  test('reads the forwarded variable names as a list', () => {
    const config = runnerConfigFrom(
      env({ RUNNER_FORWARD_ENV: 'ANTHROPIC_API_KEY, OTHER' }),
      'production',
    )

    expect(config.forwardEnv).toEqual(['ANTHROPIC_API_KEY', 'OTHER'])
  })

  test('rejects a non-positive stage timeout', () => {
    expect(() => env({ STAGE_TIMEOUT_MS: '0' })).toThrow()
  })
})
