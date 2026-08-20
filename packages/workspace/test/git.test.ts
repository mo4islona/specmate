import { describe, expect, test } from 'bun:test'
import {
  Git,
  GitError,
  type GitSpawn,
  gitEnv,
  resolveWorkspaceConfig,
  type SpawnSpec,
} from '../src/index.ts'

function recordingSpawn(): { spawn: GitSpawn; calls: SpawnSpec[] } {
  const calls: SpawnSpec[] = []
  const stream = (text: string) =>
    new Response(text).body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() })
  const spawn: GitSpawn = (spec) => {
    calls.push(spec)
    return { stdout: stream('out'), stderr: stream(''), exited: Promise.resolve(0) }
  }
  return { spawn, calls }
}

describe('git environment', () => {
  test('disables every prompt and ignores the host git config', () => {
    const env = gitEnv()
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(env.GIT_CONFIG_SYSTEM).toBe('/dev/null')
    expect(env.GIT_SSH_COMMAND).toBeUndefined()
  })

  test('builds a GitHub credential header only when configured', async () => {
    const git = new Git(
      resolveWorkspaceConfig({ root: '/tmp/x', githubToken: async () => 'a token' }),
    )
    await expect(git.authEnv('git@github.com:owner/repo.git')).resolves.toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from('x-access-token:a token').toString('base64')}`,
    })
    await expect(git.authEnv('file:///tmp/repo')).resolves.toBeUndefined()
  })
})

describe('git runner', () => {
  test('spawns with the fixed environment and per-invocation identity', async () => {
    const { spawn, calls } = recordingSpawn()
    const config = resolveWorkspaceConfig({
      root: '/tmp/x',
      authorName: 'SpecMate',
      authorEmail: 'bot@example.com',
    })
    const result = await new Git(config, spawn).run(['status'], { cwd: '/tmp/wt' })

    expect(result.stdout).toBe('out')
    const [call] = calls
    expect(call?.cmd).toEqual([
      'git',
      '-c',
      'user.name=SpecMate',
      '-c',
      'user.email=bot@example.com',
      'status',
    ])
    expect(call?.cwd).toBe('/tmp/wt')
    expect(call?.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(call?.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    // PATH still comes from the process; only git's own knobs are overridden.
    expect(call?.env.PATH).toBe(process.env.PATH)
  })

  test('turns a non-zero exit into an error naming the command', async () => {
    const git = new Git(resolveWorkspaceConfig({ root: '/tmp/x' }))
    const failure = git.run(['rev-parse', '--verify', 'refs/heads/nope'], { cwd: '/tmp' })
    await expect(failure).rejects.toThrow(GitError)
    await expect(failure).rejects.toThrow(/rev-parse --verify refs\/heads\/nope/)
  })

  test('tryRun reports failure without throwing', async () => {
    const git = new Git(resolveWorkspaceConfig({ root: '/tmp/x' }))
    const result = await git.tryRun(['rev-parse', '--verify', 'refs/heads/nope'], { cwd: '/tmp' })
    expect(result.exitCode).not.toBe(0)
  })
})
