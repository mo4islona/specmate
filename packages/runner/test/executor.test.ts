import { afterAll, describe, expect, it, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENT_ROLES,
  type AgentProvider,
  type AgentRole,
  DEFAULT_MODEL_BINDINGS,
  ROLE_CONTRACTS,
  type StageJob,
} from '@specmate/core'
import { SCRATCH_DIR, type WorkspaceService } from '@specmate/workspace'
import { ClaudeCodeProvider } from '../src/claude.ts'
import { DockerBackend } from '../src/docker-backend.ts'
import {
  providerRegistry,
  roleNeedsContainerRuntime,
  type StageActivityEvent,
  StageExecutor,
  type StageExecutorDeps,
  type StageRequest,
} from '../src/executor.ts'
import { LocalBackend } from '../src/local-backend.ts'
import {
  cleanupTempDirs,
  type Harness,
  makeConfig,
  makeHarness,
  STUB,
  STUB_ENV,
  setStubEnv,
  tempDir,
  writeFiles,
  writtenArtifacts,
} from './fixtures.ts'

afterAll(cleanupTempDirs)

const TASK_ID = '33333333-3333-4333-8333-333333333333'

/**
 * The database is not in the loop: a stage receives the ledger as text, so the
 * executor takes a source rather than a handle and the suite needs no Postgres.
 */
function makeExecutor(
  harness: Harness,
  env: Record<string, string>,
  configOverrides: Parameters<typeof makeConfig>[0] = {},
  depsOverrides: Partial<StageExecutorDeps> = {},
) {
  const config = makeConfig({ forwardEnv: STUB_ENV, ...configOverrides })
  setStubEnv({ SPECMATE_STUB_SLUG: harness.workspace.slug, ...env })
  // The stub stands in for the container runtime as readily as for the provider,
  // which is the only way to reach a client that never started a run.
  const backend = config.backend === 'docker' ? new DockerBackend(config) : new LocalBackend(config)
  const provider = new ClaudeCodeProvider({ config, backend })
  // Only `commitStage` is exercised here, and only its git half — the artifact
  // index has its own tests in the workspace package.

  return new StageExecutor({
    config,
    providers: providerRegistry([provider]),
    git: harness.git,
    workspaces: workspaceAdapter(harness),
    ledger: async () => '## Task\n\n- Title: a task\n',
    ...depsOverrides,
  })
}

function workspaceAdapter(harness: Harness): WorkspaceService {
  return {
    commitStage: (_taskId: string, workspace: typeof harness.workspace, stage: unknown) =>
      harness.manager.commitStage(workspace, stage as never),
    discard: (_taskId: string, workspace: typeof harness.workspace) =>
      harness.manager.discard(workspace),
    changedArtifacts: (_taskId: string, workspace: typeof harness.workspace) =>
      writtenArtifacts(workspace),
  } as unknown as WorkspaceService
}

function request(harness: Harness, overrides: Partial<StageRequest> = {}): StageRequest {
  return {
    taskId: TASK_ID,
    stageId: '44444444-4444-4444-8444-444444444444',
    role: 'researcher',
    provider: 'claude-code',
    model: 'claude-opus-5',
    reasoningEffort: 'high',
    workspace: harness.workspace,
    baseBranch: 'main',
    environment: { image: 'local://host', toolchains: [] },
    resume: null,
    ...overrides,
  }
}

async function commitCount(harness: Harness): Promise<number> {
  const log = await harness.git.run(['rev-list', '--count', 'HEAD'], {
    cwd: harness.workspace.path,
  })

  return Number(log.stdout.trim())
}

const SCENARIO = 'AC-1 — Does the thing'
const SPEC_MD = `## ADDED Requirements

### Requirement: REQ-1 — Does the thing

#### Scenario: ${SCENARIO}

- **WHEN** x
- **THEN** y
`

/** A change folder with one declared scenario — enough for the matrix to cover or miss. */
function verifierFiles(slug: string): Record<string, string> {
  return {
    'README.md': '# origin\n',
    'src/app.ts': 'export const a = 1\n',
    [`openspec/changes/${slug}/specs/example/spec.md`]: SPEC_MD,
  }
}

const BRIEF_SCENARIO = 'The redirect lands on the dashboard'

/**
 * The other acceptance source: no suite, so no `specs/` in the change folder and the
 * brief's own list is what an approve is held to (REQ-1102, REQ-1706).
 */
function briefFiles(slug: string, acceptance = true): Record<string, string> {
  const list = acceptance
    ? `#### Scenario: ${BRIEF_SCENARIO}\n\n- **WHEN** x\n- **THEN** y\n`
    : 'To be decided during implementation.\n'

  return {
    'README.md': '# origin\n',
    'src/app.ts': 'export const a = 1\n',
    [`openspec/changes/${slug}/proposal.md`]: `## What and Why\n\nSomething.\n\n## Acceptance\n\n${list}`,
  }
}

const NO_SUITE = {
  profile: 'none',
  suitePath: null,
  conventionNote: null,
  missingSuitePath: null,
} as const

function matrixTable(rows: string): string {
  return `| Scenario | Assertion | Outcome |\n| --- | --- | --- |\n${rows}`
}

describe('stage execution', () => {
  test.each([...AGENT_ROLES])(
    'derives container-runtime access for %s from its role contract',
    (role) => {
      expect(roleNeedsContainerRuntime(role)).toBe(ROLE_CONTRACTS[role].writesCode)
    },
  )

  test('passes only role-derived container-runtime access into provider jobs', async () => {
    const harness = await makeHarness('runtime-role')
    await harness.commitAll('baseline')
    const rolesDir = await tempDir('roles')
    const promptFiles = Object.fromEntries(
      AGENT_ROLES.map((role) => {
        const path = ROLE_CONTRACTS[role].promptFile
        return [path.slice(path.lastIndexOf('/') + 1), `# ${role}\n`]
      }),
    )
    await writeFiles(rolesDir, promptFiles)

    const jobs: StageJob[] = []
    const provider: AgentProvider = {
      id: 'claude-code',
      async run(job) {
        jobs.push(job)

        return {
          result: {
            schema_version: 1,
            role: job.role,
            status: 'ok',
            artifacts_changed: [],
            decisions_needed: [],
            findings: [],
            notes_md: '',
            usage: {},
          },
          log: '',
          exitCode: 0,
          durationMs: 1,
        }
      },
      async healthcheck() {
        return { provider: 'claude-code', auth: 'ok' }
      },
    }
    const config = makeConfig({ rolesDir })
    const executor = new StageExecutor({
      config,
      providers: providerRegistry([provider]),
      git: harness.git,
      workspaces: workspaceAdapter(harness),
      ledger: async () => '',
    })

    for (const role of AGENT_ROLES) {
      const legacyOverride = { needsContainerRuntime: !ROLE_CONTRACTS[role].writesCode }
      await executor.execute({
        ...request(harness),
        ...legacyOverride,
        stageId: crypto.randomUUID(),
        role,
      } as StageRequest)
    }

    expect(
      Object.fromEntries(
        jobs.map(
          (job) => [job.role, job.needsContainerRuntime ?? false] satisfies [AgentRole, boolean],
        ),
      ),
    ).toEqual(
      Object.fromEntries(AGENT_ROLES.map((role) => [role, ROLE_CONTRACTS[role].writesCode])),
    )
  })

  test('passes the complete pinned environment into the provider job', async () => {
    const harness = await makeHarness('task-image')
    await harness.commitAll('baseline')
    let jobEnvironment: StageJob['environment'] | undefined
    const config = makeConfig({ forwardEnv: STUB_ENV })
    const delegate = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
    const provider: AgentProvider = {
      id: delegate.id,
      run(job) {
        jobEnvironment = job.environment

        return delegate.run(job)
      },
      healthcheck: () => delegate.healthcheck(),
    }
    setStubEnv({ SPECMATE_STUB_SLUG: harness.workspace.slug, SPECMATE_STUB_MODE: 'ok' })
    const executor = new StageExecutor({
      config,
      providers: providerRegistry([provider]),
      git: harness.git,
      workspaces: workspaceAdapter(harness),
      ledger: async () => '',
    })

    const environment = {
      image: `runner@sha256:${'a'.repeat(64)}`,
      toolchains: [{ name: 'bun', version: '1.3.9' }],
    }
    await executor.execute(request(harness, { environment }))

    expect(jobEnvironment).toEqual(environment)
  })

  test('dispatches the model and reasoning effort resolved on the request, not the process-level default (AC-230, AC-231)', async () => {
    const harness = await makeHarness('task-model')
    await harness.commitAll('baseline')
    const dispatched: { model: string; reasoningEffort: string }[] = []
    // Nothing process-level names a model any more; the shipped factory default
    // is the nearest thing, and proving the dispatched values differ from it is
    // what shows the resolved binding wins (AC-231).
    const config = makeConfig({ forwardEnv: STUB_ENV })
    const delegate = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
    const provider: AgentProvider = {
      id: delegate.id,
      run(job) {
        dispatched.push({ model: job.model, reasoningEffort: job.reasoningEffort })

        return delegate.run(job)
      },
      healthcheck: () => delegate.healthcheck(),
    }
    setStubEnv({ SPECMATE_STUB_SLUG: harness.workspace.slug, SPECMATE_STUB_MODE: 'ok' })
    const executor = new StageExecutor({
      config,
      providers: providerRegistry([provider]),
      git: harness.git,
      workspaces: workspaceAdapter(harness),
      ledger: async () => '',
    })

    await executor.execute(
      request(harness, { role: 'researcher', model: 'claude-sonnet-5', reasoningEffort: 'low' }),
    )
    await executor.execute(
      request(harness, { role: 'implementer', model: 'claude-fable-5', reasoningEffort: 'max' }),
    )

    expect(dispatched).toEqual([
      { model: 'claude-sonnet-5', reasoningEffort: 'low' },
      { model: 'claude-fable-5', reasoningEffort: 'max' },
    ])
    expect(dispatched.map((d) => d.model)).not.toContain(DEFAULT_MODEL_BINDINGS.researcher.model)
  })

  test('commits the output of a run that stayed in scope', async () => {
    const harness = await makeHarness('happy')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE: 'ok' }).execute(
      request(harness),
    )

    expect(execution.status).toBe('succeeded')
    expect(execution.result?.status).toBe('ok')
    expect(execution.commit).toBeDefined()
    expect(await commitCount(harness)).toBe(before + 1)
  })

  test('fails a role that wrote outside the change folder, and commits nothing', async () => {
    const harness = await makeHarness('out-of-scope')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE: 'out-of-scope' }).execute(
      request(harness),
    )

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
    expect(execution.detail).toContain('src/app.ts')
    expect(await commitCount(harness)).toBe(before)
  })

  test('accepts the same change from a role that may modify product code', async () => {
    const harness = await makeHarness('in-scope')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE: 'out-of-scope' }).execute(
      request(harness, { role: 'implementer' }),
    )

    expect(execution.status).toBe('succeeded')
  })

  it('AC-243: accepts a declaring role writing under the name its own result declared', async () => {
    const harness = await makeHarness('declared-folder')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'a-better-name',
    }).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('succeeded')
  })

  it('AC-243: fails the same role writing under neither name', async () => {
    const harness = await makeHarness('undeclared-folder')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'a-better-name',
      SPECMATE_STUB_WRITE_CHANGE: 'somewhere-else',
    }).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
    expect(execution.detail).toContain('openspec/changes/somewhere-else')
  })

  it('AC-243: accepts a declaring role under a layout the repository does not carry', async () => {
    // `git status` reports nothing here — the folder is excluded from commits — so the
    // check sees this run's work only through what the store is compared against.
    // Nothing to baseline: under this layout the scaffolding is excluded from commits.
    const harness = await makeHarness('declared-internal', undefined, 'internal')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'a-better-name',
    }).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('succeeded')
  })

  it('AC-250: fails a write outside either folder under that layout too', async () => {
    // Nothing to baseline: under this layout the scaffolding is excluded from commits.
    const harness = await makeHarness('undeclared-internal', undefined, 'internal')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'a-better-name',
      SPECMATE_STUB_WRITE_CHANGE: 'somewhere-else',
    }).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
    expect(execution.detail).toContain('.specmate/changes/somewhere-else')
  })

  /**
   * The widening is for the window before convergence, when the folder the check
   * knows about is still the provisional one. Once the task has converged its
   * folder is decided, and a later re-declaration naming some other change would
   * otherwise open that change's folder to writes this task has no business
   * making — the leak AC-742 exists to close.
   */
  it('AC-742: refuses the declared name once the task has converged on its folder', async () => {
    const harness = await makeHarness('converged-task')
    // Before the baseline commit: a folder already in the history keeps its
    // provisional name, and this task is one that converged on a declared one.
    const converged = await harness.manager.renameChangeFolder(harness.workspace, 'its-own-name')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'stale-lease-retry',
    }).execute(request(harness, { role: 'planner', workspace: converged }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
    expect(execution.detail).toContain('openspec/changes/stale-lease-retry')
  })

  it('AC-742: refuses a declared name the repository already keeps a change under', async () => {
    const harness = await makeHarness('colliding-task', {
      'README.md': '# origin\n',
      'openspec/changes/stale-lease-retry/proposal.md': '# somebody else\n',
    })
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'planner',
      SPECMATE_STUB_PLAN_CHANGE: 'stale-lease-retry',
    }).execute(request(harness, { role: 'planner' }))

    // Convergence would suffix this task's folder away from that name, so
    // anything written there is committed into work that is not this task's.
    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
  })

  it('AC-243: leaves a role that declares no change name held to its own folder', async () => {
    const harness = await makeHarness('non-declaring')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'declares-change',
      SPECMATE_STUB_ROLE: 'researcher',
      SPECMATE_STUB_WRITE_CHANGE: 'a-better-name',
    }).execute(request(harness))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('scope_violation')
  })

  test('an honestly reported failure commits nothing to the task branch', async () => {
    const harness = await makeHarness('agent-failed')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE: 'agent-failed' }).execute(
      request(harness),
    )

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('agent_failed')
    expect(execution.detail).toContain('could not finish')
    expect(await commitCount(harness)).toBe(before)
  })

  // REQ-215, AC-241.
  test('runs each stage under the provider its job names', async () => {
    const harness = await makeHarness('two-providers')
    await harness.commitAll('baseline')
    const config = makeConfig({ forwardEnv: STUB_ENV })
    setStubEnv({ SPECMATE_STUB_SLUG: harness.workspace.slug, SPECMATE_STUB_MODE: 'ok' })

    const ran: string[] = []
    const spy = (delegate: AgentProvider, id: AgentProvider['id']): AgentProvider => ({
      id,
      run(job) {
        ran.push(job.provider)

        return delegate.run(job)
      },
      healthcheck: () => delegate.healthcheck(),
    })
    const delegate = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
    const executor = new StageExecutor({
      config,
      providers: providerRegistry([spy(delegate, 'claude-code'), spy(delegate, 'codex')]),
      git: harness.git,
      workspaces: workspaceAdapter(harness),
      ledger: async () => '',
    })

    await executor.execute(request(harness, { provider: 'codex' }))
    await executor.execute(request(harness, { provider: 'claude-code' }))

    expect(ran).toEqual(['codex', 'claude-code'])
  })

  // AC-242.
  test('a stage bound to a provider this deployment does not run is refused', async () => {
    const harness = await makeHarness('wrong-provider')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE: 'ok' }).execute(
      request(harness, { provider: 'codex' }),
    )

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('provider_error')
    expect(execution.detail).toContain('codex')
  })

  test('retries once and no more', async () => {
    const harness = await makeHarness('retry-cap')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['no-result', 'no-result', 'ok']))

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
    }).execute(request(harness))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('no_result')
    expect(execution.attempts).toHaveLength(2)
  })

  it('a stop ends the loop instead of being answered with another attempt', async () => {
    const harness = await makeHarness('retry-stopped')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['no-result', 'ok']))
    const stop = new AbortController()

    // The ledger is assembled once per attempt, so aborting from it lands while the
    // first attempt is still on the wire — which is where a real stop lands.
    const stopMidRun = async () => {
      stop.abort()

      return '## Task\n\n- Title: a task\n'
    }

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE_FILE: queue },
      {},
      { ledger: stopMidRun },
    ).execute(request(harness, { signal: stop.signal }))

    // Without the stop the queued 'ok' would have made this a success.
    expect(execution.attempts).toHaveLength(1)
    expect(execution.status).toBe('failed')
  })

  it('names the backend, not the provider, for a run that never started (AC-246)', async () => {
    const harness = await makeHarness('unstarted')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE: 'client-start-failure' },
      { backend: 'docker', dockerCli: STUB },
    ).execute(request(harness))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('backend_error')
    expect(execution.detail).toContain('pull access denied')
  })

  it('names the provider for one that ran and left nothing (AC-247)', async () => {
    const harness = await makeHarness('provider-exit')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'nonzero-exit',
    }).execute(request(harness))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('provider_error')
    expect(execution.detail).toContain('exited 3')
  })

  it('AC-248, AC-249: tells the retry what the attempt before it was rejected for', async () => {
    const harness = await makeHarness('rejection-carried')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['out-of-scope', 'ok']))
    const stage = request(harness)

    const execution = await makeExecutor(harness, { SPECMATE_STUB_MODE_FILE: queue }).execute(stage)

    // Each attempt writes its own prompt into its own scratch directory, which
    // outlives the discard between them.
    const promptOf = (attempt: number) =>
      readFile(
        join(harness.workspace.path, SCRATCH_DIR, `${stage.stageId}-${attempt}`, 'prompt.md'),
        'utf8',
      )

    expect(execution.status).toBe('succeeded')
    expect(await promptOf(0)).not.toContain('# Your previous attempt')

    const retryPrompt = await promptOf(1)

    expect(retryPrompt).toContain('Attempt 0 ended: The run changed files its role may not touch.')
    expect(retryPrompt).toContain('That is the correction to make')
    // The discard between attempts is invisible from inside the session this
    // retry continues: its transcript says it already wrote the artifacts.
    expect(retryPrompt).toContain('taken back to the last accepted commit')
  })

  it('AC-244: continues the declined attempt’s own session on the retry', async () => {
    const harness = await makeHarness('declined-session')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['out-of-scope', 'ok']))
    const record = join(await tempDir('record'), 'run.json')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_SESSION: 'sess-declined',
      SPECMATE_STUB_RECORD: record,
    }).execute(request(harness))

    // The record is overwritten per invocation, so it holds the retry's own argv.
    const retry = (await Bun.file(record).json()) as { argv: string[] }

    expect(execution.status).toBe('succeeded')
    expect(retry.argv).toContain('--fork-session')
    expect(retry.argv[retry.argv.indexOf('--resume') + 1]).toBe('sess-declined')
  })

  it('AC-245: starts cold after a run that failed rather than one that was declined', async () => {
    const harness = await makeHarness('failed-session')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['no-result', 'ok']))
    const record = join(await tempDir('record'), 'run.json')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_SESSION: 'sess-failed',
      SPECMATE_STUB_RECORD: record,
    }).execute(request(harness))

    const retry = (await Bun.file(record).json()) as { argv: string[] }

    expect(execution.status).toBe('succeeded')
    expect(retry.argv).not.toContain('--resume')
  })

  it('AC-245: a fork the provider refuses degrades to a cold start, with the reason', async () => {
    const harness = await makeHarness('refused-fork')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['out-of-scope', 'ok']))

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_SESSION: 'sess-declined',
      SPECMATE_STUB_REFUSE_FORK: 'sess-declined',
    }).execute(request(harness))

    expect(execution.status).toBe('succeeded')
    expect(execution.coldStartReason).toContain('sess-declined')
  })

  /**
   * The fallback chain is two levels deep going in — the declined attempt's own
   * session, then the node's resumption — so it has to be two deep coming out.
   * Dropping straight to cold throws away grounding nobody refused, and the
   * cold-start reason then names only the session that was.
   */
  it('AC-235: falls back to the node’s own session before giving up on grounding', async () => {
    const harness = await makeHarness('fallback-chain')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['out-of-scope', 'ok']))
    const record = join(await tempDir('record'), 'run.json')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_SESSION: 'sess-declined',
      SPECMATE_STUB_REFUSE_FORK: 'sess-declined',
      SPECMATE_STUB_RECORD: record,
    }).execute(request(harness, { resume: { node: 'planning', sessionId: 'sess-planning' } }))

    const last = (await Bun.file(record).json()) as { argv: string[] }

    expect(execution.status).toBe('succeeded')
    expect(last.argv[last.argv.indexOf('--resume') + 1]).toBe('sess-planning')
    expect(execution.coldStartReason).toContain('sess-declined')
    expect(execution.coldStartReason).toContain('sess-planning')
  })

  it('makes no second attempt at a run the backend could not start', async () => {
    const harness = await makeHarness('unstarted-once')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['client-start-failure', 'client-start-failure']))

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE_FILE: queue },
      { backend: 'docker', dockerCli: STUB },
    ).execute(request(harness))

    // The queue is consumed one entry per invocation, so what is left of it says
    // how many runs there were.
    expect(execution.attempts).toHaveLength(1)
    expect(JSON.parse(await readFile(queue, 'utf8'))).toHaveLength(1)
  })

  it('still spends both attempts on a timeout, which might not recur', async () => {
    const harness = await makeHarness('timeout-twice')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['hang', 'hang']))

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE_FILE: queue },
      { stageTimeoutMs: 300 },
    ).execute(request(harness))

    expect(execution.failure).toBe('timeout')
    expect(execution.attempts).toHaveLength(2)
    expect(JSON.parse(await readFile(queue, 'utf8'))).toHaveLength(0)
  })

  test('starts the retry from committed state, not from what the failure left', async () => {
    const harness = await makeHarness('clean-retry')
    const proposal = join(harness.workspace.path, 'openspec/changes/clean-retry/proposal.md')
    await writeFile(proposal, '# COMMITTED-TEXT\n')
    await harness.commitAll('baseline')

    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['half-written', 'ok']))
    const record = join(await tempDir('record'), 'record.json')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE_FILE: queue,
      SPECMATE_STUB_RECORD: record,
      SPECMATE_STUB_ROLE: 'researcher',
    }).execute(request(harness))

    // The second attempt's prompt is the last one recorded.
    const seen = (await Bun.file(record).json()) as { prompt: string }
    expect(seen.prompt).toContain('# COMMITTED-TEXT')
    expect(seen.prompt).not.toContain('HALF-WRITTEN-GARBAGE')
    expect(execution.status).toBe('succeeded')
    expect(await readFile(proposal, 'utf8')).toBe('# written by the stub\n')
  })

  test('attributes activity to the running stage and current attempt, distinct from a discarded attempt (AC-229)', async () => {
    const harness = await makeHarness('activity-attribution')
    await harness.commitAll('baseline')
    const queue = join(await tempDir('queue'), 'modes.json')
    await writeFile(queue, JSON.stringify(['no-result', 'activity']))
    const seen: StageActivityEvent[] = []

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE_FILE: queue },
      {},
      { onActivity: (event) => seen.push(event) },
    ).execute(request(harness))

    expect(execution.status).toBe('succeeded')
    expect(seen.length).toBeGreaterThan(0)
    for (const event of seen) {
      expect(event.taskId).toBe(TASK_ID)
      expect(event.stageId).toBe(request(harness).stageId)
      // The discarded attempt (0, 'no-result') produced no activity to begin
      // with — every event traces to the attempt that actually succeeded.
      expect(event.attempt).toBe(1)
    }
  })
})

describe('verification corroboration', () => {
  test('fails an uncorroborated approve, naming the scenario, and commits nothing', async () => {
    const slug = 'verify-uncorroborated'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'approve',
      SPECMATE_STUB_MATRIX: matrixTable(''),
    }).execute(request(harness, { role: 'verifier' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('uncorroborated')
    expect(execution.detail).toContain(SCENARIO)
    expect(await commitCount(harness)).toBe(before)
  })

  test('accepts an approve corroborated by a fully-covered, all-pass matrix', async () => {
    const slug = 'verify-approve'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'approve',
      SPECMATE_STUB_MATRIX: matrixTable(`| ${SCENARIO} | \`bun test\` | pass |\n`),
    }).execute(request(harness, { role: 'verifier' }))

    expect(execution.status).toBe('succeeded')
    expect(execution.result?.verdict).toBe('approve')
    expect(execution.result?.findings).toEqual([])
  })

  test("AC-1114: with no suite, an approve is corroborated against the brief's acceptance list", async () => {
    const slug = 'verify-brief-source'
    const harness = await makeHarness(slug, briefFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'approve',
      SPECMATE_STUB_MATRIX: matrixTable(`| ${BRIEF_SCENARIO} | \`bun test\` | pass |\n`),
    }).execute(request(harness, { role: 'verifier', specConvention: NO_SUITE }))

    expect(execution.status).toBe('succeeded')
    expect(execution.result?.verdict).toBe('approve')
  })

  test('AC-1115: an approve over an acceptance source with no scenario fails the attempt', async () => {
    const slug = 'verify-empty-inventory'
    const harness = await makeHarness(slug, briefFiles(slug, false))
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'approve',
      SPECMATE_STUB_MATRIX: matrixTable(''),
    }).execute(request(harness, { role: 'verifier', specConvention: NO_SUITE }))

    expect(execution.status).toBe('failed')
    expect(execution.detail).toContain('declares no scenario')
    expect(await commitCount(harness)).toBe(before)
  })

  test('an honest revise is accepted with its derived scenario finding attached', async () => {
    const slug = 'verify-revise'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'revise',
      SPECMATE_STUB_MATRIX: matrixTable(`| ${SCENARIO} | \`bun test\` | fail |\n`),
    }).execute(request(harness, { role: 'verifier' }))

    expect(execution.status).toBe('succeeded')
    expect(execution.result?.verdict).toBe('revise')
    expect(execution.result?.findings.map((f) => f.id)).toEqual(['AC-1'])
  })

  test('rejects a revise with nothing to act on — no agent findings, nothing to derive', async () => {
    const slug = 'verify-empty-revise'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'revise',
      SPECMATE_STUB_MATRIX: matrixTable(`| ${SCENARIO} | \`bun test\` | pass |\n`),
    }).execute(request(harness, { role: 'verifier' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('uncheckable_verdict')
  })

  test('fails as an uncheckable verdict when the report cannot be found', async () => {
    const slug = 'verify-no-report'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'verify-no-report',
      SPECMATE_STUB_VERDICT: 'approve',
    }).execute(request(harness, { role: 'verifier' }))

    // Not `invalid_result`: the result parsed and cleared every earlier check.
    // What could not be read is the verdict's evidence, so the reasoning behind
    // it is worth handing back rather than starting the retry cold.
    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('uncheckable_verdict')
    expect(execution.detail).toContain('verification.md')
  })

  test('a reviewer outcome with findings and no matrix passes the executor unchanged', async () => {
    const harness = await makeHarness('review-untouched')
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'revise',
      SPECMATE_STUB_ROLE: 'reviewer',
      SPECMATE_STUB_FINDING: 'my-finding',
    }).execute(request(harness, { role: 'reviewer' }))

    expect(execution.status).toBe('succeeded')
    expect(execution.result?.findings.map((f) => f.id)).toEqual(['my-finding'])
  })

  test('walks a verify stage through the executor: honest revise accepted, dishonest approve rejected', async () => {
    const slug = 'verify-e2e'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const revise = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'revise',
      SPECMATE_STUB_MATRIX: matrixTable(`| ${SCENARIO} | \`bun test\` | fail |\n`),
    }).execute(request(harness, { role: 'verifier' }))

    expect(revise.status).toBe('succeeded')
    expect(revise.result?.findings.map((f) => f.id)).toEqual(['AC-1'])
    expect(await commitCount(harness)).toBe(before + 1)

    const approve = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'validate',
      SPECMATE_STUB_VERDICT: 'approve',
      SPECMATE_STUB_MATRIX: matrixTable(''),
    }).execute(request(harness, { role: 'verifier' }))

    expect(approve.status).toBe('failed')
    expect(approve.failure).toBe('uncorroborated')
    expect(await commitCount(harness)).toBe(before + 1)
  })
})

describe('brief completeness', () => {
  async function plannerRolesDir(): Promise<string> {
    const dir = await tempDir('roles')
    await writeFiles(dir, { 'planner.md': '# Role: Planner\n' })

    return dir
  }

  test('fails a planner run that left an incomplete brief, and commits nothing', async () => {
    const harness = await makeHarness('brief-incomplete')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE: 'brief-incomplete', SPECMATE_STUB_ROLE: 'planner' },
      { rolesDir: await plannerRolesDir() },
    ).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('incomplete_brief')
    expect(execution.detail).toContain('missing')
    expect(await commitCount(harness)).toBe(before)
  })

  test('AC-1329: fires on a proposal the repository does not carry, and commits nothing', async () => {
    // Nothing to baseline: under this layout the scaffolding is excluded from commits.
    const harness = await makeHarness('brief-internal', undefined, 'internal')
    const before = await commitCount(harness)

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE: 'brief-incomplete', SPECMATE_STUB_ROLE: 'planner' },
      { rolesDir: await plannerRolesDir() },
    ).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('incomplete_brief')
    expect(await commitCount(harness)).toBe(before)
  })

  test('commits a planner run that left a complete brief', async () => {
    const harness = await makeHarness('brief-complete')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(
      harness,
      { SPECMATE_STUB_MODE: 'brief-complete', SPECMATE_STUB_ROLE: 'planner' },
      { rolesDir: await plannerRolesDir() },
    ).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('succeeded')
    expect(await commitCount(harness)).toBe(before + 1)
  })

  test('fails a complete-otherwise brief that stays silent about missing coverage, and commits nothing', async () => {
    const harness = await makeHarness('brief-coverage-silent')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    const execution = await makeExecutor(
      harness,
      {
        SPECMATE_STUB_MODE: 'brief-complete',
        SPECMATE_STUB_ROLE: 'planner',
        SPECMATE_STUB_HARNESS_CLASSIFICATION: 'missing',
      },
      { rolesDir: await plannerRolesDir() },
    ).execute(request(harness, { role: 'planner' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('incomplete_brief')
    expect(execution.detail).toContain('Harness gap')
    expect(await commitCount(harness)).toBe(before)
  })

  test('a researcher rewriting the proposal into a full proposal passes the executor unchanged', async () => {
    const harness = await makeHarness('researcher-proposal')
    await harness.commitAll('baseline')
    const before = await commitCount(harness)

    // The researcher's contract does not declare checksProposalCompleteness,
    // so a bare proposal.md — which would fail the planner's brief check — is
    // untouched by it here.
    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'ok',
      SPECMATE_STUB_ROLE: 'researcher',
    }).execute(request(harness, { role: 'researcher' }))

    expect(execution.status).toBe('succeeded')
    expect(await commitCount(harness)).toBe(before + 1)
  })
})
