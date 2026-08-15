import { afterAll, describe, expect, test } from 'bun:test'
import type { ExecSpec } from '../src/backend.ts'
import {
  DOCKER_SOCKET,
  DockerBackend,
  immutableImageFromInspection,
  isImmutableImageReference,
  MISE_SHARED_ROOT,
  SPECMATE_TOOLCHAINS_ENV,
} from '../src/docker-backend.ts'
import { LocalBackend } from '../src/local-backend.ts'
import { cleanupTempDirs, makeConfig, STUB, tempDir } from './fixtures.ts'

afterAll(cleanupTempDirs)

function spec(overrides: Partial<ExecSpec> = {}): ExecSpec {
  return {
    argv: [STUB],
    stdin: 'prompt',
    workspacePath: '/var/lib/specmate/workspaces/tasks/demo',
    env: {},
    timeoutMs: 5_000,
    limits: { cpus: '2', memory: '4g' },
    containerRuntime: false,
    label: 'stage-1',
    ...overrides,
  }
}

describe('local backend', () => {
  test('kills a run that outlives its deadline and says so', async () => {
    const workspacePath = await tempDir('hang')
    const backend = new LocalBackend(makeConfig())

    const result = await backend.run(
      spec({ workspacePath, timeoutMs: 300, env: { SPECMATE_STUB_MODE: 'hang' } }),
    )

    expect(result.timedOut).toBe(true)
    expect(result.durationMs).toBeLessThan(5_000)
  })

  test('passes the prompt on stdin and reports a non-zero exit', async () => {
    const workspacePath = await tempDir('exit')
    const backend = new LocalBackend(makeConfig())

    const result = await backend.run(
      spec({ workspacePath, env: { SPECMATE_STUB_MODE: 'nonzero-exit' } }),
    )

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('stub failed on purpose')
  })

  test('hands the provider an explicit environment, not the orchestrator’s', async () => {
    const workspacePath = await tempDir('env')
    const record = `${workspacePath}/record.json`
    const backend = new LocalBackend(makeConfig())
    const previous = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://should-not-be-visible'

    try {
      await backend.run(
        spec({
          workspacePath,
          argv: [STUB],
          env: { SPECMATE_STUB_MODE: 'no-result', SPECMATE_STUB_RECORD: record },
        }),
      )
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }

    const seen = (await Bun.file(record).json()) as { env: Record<string, string> }
    expect(seen.env.DATABASE_URL).toBeUndefined()
    expect(seen.env.HOME).toBeDefined()
  })
})

describe('docker backend', () => {
  const backend = new DockerBackend(makeConfig({ backend: 'docker' }))

  test('mounts the worktree, auth, and shared toolchains volumes', () => {
    const argv = backend.argv(spec())

    expect(argv.slice(0, 3)).toEqual(['docker', 'run', '--rm'])
    const mounts = argv.filter((_, i) => argv[i - 1] === '--volume')
    expect(mounts).toEqual([
      '/var/lib/specmate/workspaces/tasks/demo:/var/lib/specmate/workspaces/tasks/demo',
      'specmate_claude-auth:/home/agent',
      `specmate_toolchains:${MISE_SHARED_ROOT}:ro`,
    ])
    expect(argv).toContain('--user')
    expect(argv).toContain('10001:10001')
    expect(argv.join(' ')).not.toContain('DATABASE_URL')
    expect(argv.join(' ')).not.toContain(DOCKER_SOCKET)
    expect(argv).toContain(`${SPECMATE_TOOLCHAINS_ENV}=[]`)
  })

  test('caps cpu and memory and runs in the workspace', () => {
    const argv = backend.argv(spec())

    expect(argv[argv.indexOf('--cpus') + 1]).toBe('2')
    expect(argv[argv.indexOf('--memory') + 1]).toBe('4g')
    expect(argv[argv.indexOf('--workdir') + 1]).toBe('/var/lib/specmate/workspaces/tasks/demo')
  })

  test('passes the complete pinned environment into a stage', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const argv = backend.argv(
      spec({
        environment: {
          image: digest,
          toolchains: [{ name: 'node', version: '22.14.0' }],
        },
      }),
    )

    expect(argv).toContain(digest)
    expect(argv).toContain(`${SPECMATE_TOOLCHAINS_ENV}=[{"name":"node","version":"22.14.0"}]`)
  })

  test('grants no container runtime unless the stage declared it', () => {
    const withoutIt = new DockerBackend(makeConfig({ backend: 'docker' })).argv(spec())
    const withIt = new DockerBackend(makeConfig({ backend: 'docker' })).argv(
      spec({ containerRuntime: true }),
    )

    expect(withoutIt.join(' ')).not.toContain(DOCKER_SOCKET)
    expect(withIt).toContain(`${DOCKER_SOCKET}:${DOCKER_SOCKET}`)
  })

  test('forwards a named variable without putting its value on the command line', () => {
    const forwarding = new DockerBackend(makeConfig({ backend: 'docker', forwardEnv: ['SECRET'] }))

    const argv = forwarding.argv(spec())

    expect(argv).toContain('SECRET')
    expect(argv.join(' ')).not.toContain('SECRET=')
  })

  test('names the container so a deadline has something to kill', () => {
    const argv = backend.argv(spec({ label: 'stage/1:2' }))

    expect(argv[argv.indexOf('--name') + 1]).toBe('specmate-stage-1-2')
  })
})

describe('runner image pinning', () => {
  const digest = 'a'.repeat(64)

  test('recognises repository digests and image IDs as immutable', () => {
    expect(isImmutableImageReference(`registry.example/runner@sha256:${digest}`)).toBe(true)
    expect(isImmutableImageReference(`sha256:${digest}`)).toBe(true)
    expect(isImmutableImageReference('registry.example/runner:latest')).toBe(false)
  })

  test('prefers the requested repository digest from image inspection', () => {
    const other = 'b'.repeat(64)
    const raw = JSON.stringify([
      {
        Id: `sha256:${other}`,
        RepoDigests: [
          `mirror.example/runner@sha256:${other}`,
          `registry.example/runner@sha256:${digest}`,
        ],
      },
    ])

    expect(immutableImageFromInspection('registry.example/runner:local', raw)).toBe(
      `registry.example/runner@sha256:${digest}`,
    )
  })

  test('falls back to the immutable local image ID', () => {
    const other = 'b'.repeat(64)
    expect(
      immutableImageFromInspection(
        'specmate/runner-universal:local',
        JSON.stringify([
          {
            Id: `sha256:${digest}`,
            RepoDigests: [`mirror.example/runner@sha256:${other}`],
          },
        ]),
      ),
    ).toBe(`sha256:${digest}`)
  })
})

describe('docker deadline', () => {
  test('reaches the container, not just the client', async () => {
    const workspacePath = await tempDir('docker-timeout')
    const killed: string[] = []
    // `docker run` is only a client — killing it would leave the container
    // running, so the deadline has to name and kill the container itself.
    const backend = new DockerBackend(
      makeConfig({ backend: 'docker', dockerCli: STUB, forwardEnv: ['SPECMATE_STUB_MODE'] }),
      (name) => killed.push(name),
    )
    process.env.SPECMATE_STUB_MODE = 'hang'

    const result = await backend.run(
      spec({ workspacePath, timeoutMs: 200, argv: [STUB], label: 'stage-9' }),
    )

    expect(result.timedOut).toBe(true)
    expect(killed).toEqual(['specmate-stage-9'])
  })
})
