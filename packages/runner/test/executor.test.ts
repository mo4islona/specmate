import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENT_ROLES,
  type AgentProvider,
  type AgentRole,
  ROLE_CONTRACTS,
  type StageJob,
} from '@specmate/core'
import type { WorkspaceService } from '@specmate/workspace'
import { ClaudeCodeProvider } from '../src/claude.ts'
import {
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
  STUB_ENV,
  setStubEnv,
  tempDir,
  writeFiles,
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
  const provider = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
  // Only `commitStage` is exercised here, and only its git half — the artifact
  // index has its own tests in the workspace package.

  return new StageExecutor({
    config,
    provider,
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
    discard: (workspace: typeof harness.workspace) => harness.manager.discard(workspace),
  } as unknown as WorkspaceService
}

function request(harness: Harness, overrides: Partial<StageRequest> = {}): StageRequest {
  return {
    taskId: TASK_ID,
    stageId: '44444444-4444-4444-8444-444444444444',
    role: 'researcher',
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
      provider,
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
      provider,
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
    // The process-level config carries its own default model (and no effort at
    // all) — proving the dispatched values differ from it is what shows the
    // resolved binding wins (AC-231).
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
      provider,
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
    expect(dispatched.map((d) => d.model)).not.toContain(config.model)
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

  test('a stage bound to a different provider is refused, not silently re-attributed', async () => {
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
    expect(execution.failure).toBe('invalid_result')
  })

  test('fails as an invalid result when the report cannot be found', async () => {
    const slug = 'verify-no-report'
    const harness = await makeHarness(slug, verifierFiles(slug))
    await harness.commitAll('baseline')

    const execution = await makeExecutor(harness, {
      SPECMATE_STUB_MODE: 'verify-no-report',
      SPECMATE_STUB_VERDICT: 'approve',
    }).execute(request(harness, { role: 'verifier' }))

    expect(execution.status).toBe('failed')
    expect(execution.failure).toBe('invalid_result')
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
