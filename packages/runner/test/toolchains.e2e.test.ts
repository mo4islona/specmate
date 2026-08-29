import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { AgentProvider, StageJob, StageOutcome } from '@specmate/core'
import type { WorkspaceService } from '@specmate/workspace'
import type { ExecResult } from '../src/backend.ts'
import { DockerBackend } from '../src/docker-backend.ts'
import { providerRegistry, StageExecutor } from '../src/executor.ts'
import { cleanupTempDirs, makeConfig, makeHarness } from './fixtures.ts'

const describeDocker = process.env.SPECMATE_RUN_DOCKER_TESTS === '1' ? describe : describe.skip
const image = process.env.RUNNER_IMAGE ?? 'specmate/runner-universal:local'
const toolchainsVolume = `specmate-test-toolchains-${randomUUID()}`
const authVolume = `specmate-test-auth-${randomUUID()}`

afterAll(async () => {
  await cleanupTempDirs()
  if (process.env.SPECMATE_RUN_DOCKER_TESTS !== '1') return

  await removeVolumes([toolchainsVolume, authVolume])
})

describeDocker('universal runner toolchains', () => {
  test(
    'pins an exact version, ignores later declaration drift, and protects the shared install',
    async () => {
      const version = '22.14.0'
      const harness = await makeHarness('docker-toolchain', {
        'package.json': JSON.stringify({ engines: { node: '>=22.14.0 <22.15.0' } }),
      })
      await harness.commitAll('baseline')
      const config = makeConfig({
        backend: 'docker',
        image,
        providers: { 'claude-code': { cli: 'claude', authVolume, forwardEnv: [] } },
        toolchainsVolume,
        stageTimeoutMs: 10 * 60_000,
      })
      const backend = new DockerBackend(config)
      const environment = await backend.resolveEnvironment(harness.workspace.path, image)
      expect(environment.toolchains).toEqual([{ name: 'node', version }])
      expect(environment.image).toMatch(/(?:^|@)sha256:[a-f0-9]{64}$/)

      // A successful implementation stage may legitimately edit this file. The
      // next stage must still use the task pin until an explicit re-pin occurs.
      await writeFile(
        `${harness.workspace.path}/package.json`,
        JSON.stringify({ engines: { node: '0.0.0-specmate-must-not-be-read' } }),
      )
      const provider = new ToolchainProbeProvider(config)
      const executor = new StageExecutor({
        config,
        providers: providerRegistry([provider]),
        git: harness.git,
        workspaces: workspaceAdapter(harness),
        ledger: async () => '',
      })

      const first = await executor.execute({
        taskId: randomUUID(),
        stageId: randomUUID(),
        role: 'implementer',
        provider: 'claude-code',
        model: 'claude-opus-5',
        reasoningEffort: 'high',
        workspace: harness.workspace,
        baseBranch: 'main',
        environment,
        resume: null,
      })
      const second = await executor.execute({
        taskId: randomUUID(),
        stageId: randomUUID(),
        role: 'implementer',
        provider: 'claude-code',
        model: 'claude-opus-5',
        reasoningEffort: 'high',
        workspace: harness.workspace,
        baseBranch: 'main',
        environment,
        resume: null,
      })

      expect(first.status).toBe('succeeded')
      expect(second.status).toBe('succeeded')
      expect(provider.runs.map((run) => run.stdout.trim())).toEqual([`v${version}`, `v${version}`])
    },
    15 * 60_000,
  )

  test(
    'fails an unsatisfiable declaration during provisioning',
    async () => {
      const version = '0.0.0-specmate-unsatisfiable'
      const harness = await makeHarness('docker-toolchain-failure', {
        '.node-version': `${version}\n`,
      })
      const config = makeConfig({
        backend: 'docker',
        image,
        providers: { 'claude-code': { cli: 'claude', authVolume, forwardEnv: [] } },
        toolchainsVolume,
        stageTimeoutMs: 5 * 60_000,
      })
      const backend = new DockerBackend(config)

      await expect(backend.resolveEnvironment(harness.workspace.path, image)).rejects.toThrow(
        version,
      )
    },
    10 * 60_000,
  )
})

class ToolchainProbeProvider implements AgentProvider {
  readonly id = 'claude-code' as const
  readonly logs: string[] = []
  readonly runs: ExecResult[] = []
  private readonly backend: DockerBackend

  constructor(private readonly config: ReturnType<typeof makeConfig>) {
    this.backend = new DockerBackend(config)
  }

  async run(job: StageJob): Promise<StageOutcome> {
    const run = await this.backend.run({
      argv: [
        'sh',
        '-c',
        'if touch /mise/shared/installs/specmate-stage-write 2>/dev/null; then exit 91; fi\nnode --version',
      ],
      stdin: '',
      workspacePath: job.workspacePath,
      provider: this.id,
      env: { MISE_VERBOSE: '1' },
      timeoutMs: job.timeoutMs,
      limits: { cpus: this.config.cpus, memory: this.config.memory },
      containerRuntime: job.needsContainerRuntime ?? false,
      environment: job.environment,
      label: `${job.stageId}-${job.attempt}`,
    })
    this.runs.push(run)
    this.logs.push(`${run.stdout}\n${run.stderr}`)
    if (run.exitCode !== 0) throw new Error(`toolchain probe exited ${run.exitCode}`)

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
      log: this.logs.at(-1) ?? '',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
    }
  }

  async healthcheck() {
    return { provider: this.id, auth: 'ok' as const }
  }
}

function workspaceAdapter(harness: Awaited<ReturnType<typeof makeHarness>>): WorkspaceService {
  return {
    commitStage: (_taskId: string, workspace: typeof harness.workspace, stage: unknown) =>
      harness.manager.commitStage(workspace, stage as never),
    discard: (_taskId: string, workspace: typeof harness.workspace) =>
      harness.manager.discard(workspace),
    changedArtifacts: () => Promise.resolve([]),
  } as unknown as WorkspaceService
}

async function removeVolumes(volumes: string[]): Promise<void> {
  const process = Bun.spawn(['docker', 'volume', 'rm', '--force', ...volumes], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  await process.exited
}
