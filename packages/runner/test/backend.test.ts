import { afterAll, describe, expect, it, test } from 'bun:test'
import { type ExecSpec, LineBuffer } from '../src/backend.ts'
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
    provider: 'claude-code',
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

  it('reports no start failure of its own, whatever the provider exits with', async () => {
    const workspacePath = await tempDir('local-start')
    const backend = new LocalBackend(makeConfig())

    const result = await backend.run(
      spec({ workspacePath, env: { SPECMATE_STUB_MODE: 'client-start-failure' } }),
    )

    // The same exit code the docker client uses for a container it could not
    // start. Here it is the provider's own, and there are no containers to fail.
    expect(result.exitCode).toBe(125)
    expect(result.startFailure).toBeUndefined()
  })

  test('cancels one exact run, settles it once, and leaves a differently labeled run alive', async () => {
    const workspacePath = await tempDir('cancel')
    const backend = new LocalBackend(makeConfig())
    const first = backend.start(
      spec({ workspacePath, label: 'stage-a', env: { SPECMATE_STUB_MODE: 'hang' } }),
    )
    const second = backend.start(
      spec({ workspacePath, label: 'stage-b', env: { SPECMATE_STUB_MODE: 'hang' } }),
    )
    let secondSettled = false
    void second.result.finally(() => {
      secondSettled = true
    })

    await first.cancel()
    await first.cancel()
    expect((await first.result).timedOut).toBe(false)
    await Bun.sleep(50)
    expect(secondSettled).toBe(false)

    await second.cancel()
    await second.result
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

  test('binds the toolchain caches where each tool already looks, telling none of them', () => {
    const cacheRoot = '/var/lib/specmate/workspaces/caches'
    const argv = new DockerBackend(makeConfig({ backend: 'docker', cacheRoot })).argv(spec())
    const mounts = argv.filter((_, i) => argv[i - 1] === '--volume')

    expect(mounts).toContain(`${cacheRoot}/xdg-cache:/home/agent/.cache`)
    expect(mounts).toContain(`${cacheRoot}/xdg-data:/home/agent/.local/share`)
    expect(mounts).toContain(`${cacheRoot}/npm:/home/agent/.npm`)
    expect(mounts).toContain(`${cacheRoot}/cargo-registry:/home/agent/.cargo/registry`)
    // pnpm's store is `$XDG_DATA_HOME/pnpm/store`, so the mount above is the
    // whole of it: no `npm_config_store_dir`, and nothing per tool at all.
    expect(argv.join(' ')).not.toContain('npm_config')
    // The credential a provider must not share with another is in its home,
    // which is a volume of its own and stays one.
    expect(mounts).not.toContain(`${cacheRoot}/cargo:/home/agent/.cargo`)
  })

  test('shares no cache when none is configured', () => {
    const argv = new DockerBackend(makeConfig({ backend: 'docker' })).argv(spec())

    expect(argv.join(' ')).not.toContain('caches')
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

  test('labels the container with task, node, and attempt for the restart sweep', () => {
    const argv = backend.argv(
      spec({
        labels: {
          'specmate.task': 'task-1',
          'specmate.node': 'specify',
          'specmate.attempt': '0',
        },
      }),
    )

    const labels = argv.filter((_, i) => argv[i - 1] === '--label')
    expect(labels).toEqual(['specmate.task=task-1', 'specmate.node=specify', 'specmate.attempt=0'])
  })
})

describe('image resolution', () => {
  const IMAGE = 'specmate/runner-universal@sha256:85ebb7e8'

  it('answers yes for a reference the runtime can inspect', async () => {
    // `true` and `false` stand in for a client that resolves everything and one
    // that resolves nothing: the exit status is the whole of the answer.
    const backend = new DockerBackend(makeConfig({ backend: 'docker', dockerCli: 'true' }))

    expect(await backend.resolvesImage(IMAGE)).toBe(true)
  })

  it('answers no for one the runtime no longer has', async () => {
    const backend = new DockerBackend(makeConfig({ backend: 'docker', dockerCli: 'false' }))

    expect(await backend.resolvesImage(IMAGE)).toBe(false)
  })

  it('answers no when the runtime cannot be reached at all', async () => {
    const backend = new DockerBackend(
      makeConfig({ backend: 'docker', dockerCli: '/nonexistent/docker' }),
    )

    expect(await backend.resolvesImage(IMAGE)).toBe(false)
  })

  it('is yes from the in-process backend, which has no images to lose', async () => {
    expect(await new LocalBackend(makeConfig()).resolvesImage(IMAGE)).toBe(true)
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

describe('LineBuffer', () => {
  test('emits one complete line at a time, in order', () => {
    const lines: string[] = []
    const buffer = new LineBuffer()

    buffer.push('first\nsecond\nthird\n', (line) => lines.push(line))

    expect(lines).toEqual(['first', 'second', 'third'])
  })

  test('holds a line split across two pushes until it completes, dropping nothing and doubling nothing', () => {
    const lines: string[] = []
    const buffer = new LineBuffer()

    buffer.push('{"type":"assis', (line) => lines.push(line))
    buffer.push('tant"}\n{"type":"result"}\n', (line) => lines.push(line))

    expect(lines).toEqual(['{"type":"assistant"}', '{"type":"result"}'])
  })

  test('flush emits a trailing line that never got its newline', () => {
    const lines: string[] = []
    const buffer = new LineBuffer()

    buffer.push('incomplete', (line) => lines.push(line))
    buffer.flush((line) => lines.push(line))

    expect(lines).toEqual(['incomplete'])
  })

  test('flush after a clean trailing newline emits nothing extra', () => {
    const lines: string[] = []
    const buffer = new LineBuffer()

    buffer.push('one\n', (line) => lines.push(line))
    buffer.flush((line) => lines.push(line))

    expect(lines).toEqual(['one'])
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

  it('names a client that never reached the provider, carrying what the runtime said', async () => {
    const workspacePath = await tempDir('docker-start')
    const backend = new DockerBackend(
      makeConfig({ backend: 'docker', dockerCli: STUB, forwardEnv: ['SPECMATE_STUB_MODE'] }),
    )
    process.env.SPECMATE_STUB_MODE = 'client-start-failure'

    const result = await backend.run(
      spec({ workspacePath, argv: [STUB], label: 'stage-unstarted' }),
    )

    expect(result.exitCode).toBe(125)
    expect(result.startFailure).toContain('pull access denied')
  })

  test('a cancellable handle reaches the exact container and settles', async () => {
    const workspacePath = await tempDir('docker-cancel')
    const killed: string[] = []
    const backend = new DockerBackend(
      makeConfig({ backend: 'docker', dockerCli: STUB, forwardEnv: ['SPECMATE_STUB_MODE'] }),
      (name) => killed.push(name),
    )
    process.env.SPECMATE_STUB_MODE = 'hang'
    const execution = backend.start(
      spec({ workspacePath, timeoutMs: 5_000, argv: [STUB], label: 'stage-cancelled' }),
    )

    await execution.cancel()
    await execution.result
    expect(killed).toEqual(['specmate-stage-cancelled'])
  })
})
