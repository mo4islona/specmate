import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceService } from '@specmate/workspace'
import { ClaudeCodeProvider } from '../src/claude.ts'
import { StageExecutor, type StageRequest } from '../src/executor.ts'
import { LocalBackend } from '../src/local-backend.ts'
import {
  cleanupTempDirs,
  type Harness,
  makeConfig,
  makeHarness,
  STUB_ENV,
  setStubEnv,
  tempDir,
} from './fixtures.ts'

afterAll(cleanupTempDirs)

const TASK_ID = '33333333-3333-4333-8333-333333333333'

/**
 * The database is not in the loop: a stage receives the ledger as text, so the
 * executor takes a source rather than a handle and the suite needs no Postgres.
 */
function makeExecutor(harness: Harness, env: Record<string, string>) {
  const config = makeConfig({ forwardEnv: STUB_ENV })
  setStubEnv({ SPECMATE_STUB_SLUG: harness.workspace.slug, ...env })
  const provider = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
  // Only `commitStage` is exercised here, and only its git half — the artifact
  // index has its own tests in the workspace package.
  const workspaces = {
    commitStage: (_taskId: string, workspace: typeof harness.workspace, stage: unknown) =>
      harness.manager.commitStage(workspace, stage as never),
    discard: (workspace: typeof harness.workspace) => harness.manager.discard(workspace),
  } as unknown as WorkspaceService

  return new StageExecutor({
    config,
    provider,
    git: harness.git,
    workspaces,
    ledger: async () => '## Task\n\n- Title: a task\n',
  })
}

function request(harness: Harness, overrides: Partial<StageRequest> = {}): StageRequest {
  return {
    taskId: TASK_ID,
    stageId: '44444444-4444-4444-8444-444444444444',
    role: 'researcher',
    workspace: harness.workspace,
    baseBranch: 'main',
    ...overrides,
  }
}

async function commitCount(harness: Harness): Promise<number> {
  const log = await harness.git.run(['rev-list', '--count', 'HEAD'], {
    cwd: harness.workspace.path,
  })

  return Number(log.stdout.trim())
}

describe('stage execution', () => {
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
    }).execute(request(harness))

    // The second attempt's prompt is the last one recorded.
    const seen = (await Bun.file(record).json()) as { prompt: string }
    expect(seen.prompt).toContain('# COMMITTED-TEXT')
    expect(seen.prompt).not.toContain('HALF-WRITTEN-GARBAGE')
    expect(execution.status).toBe('succeeded')
    expect(await readFile(proposal, 'utf8')).toBe('# written by the stub\n')
  })
})
