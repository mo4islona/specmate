import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Git, resolveWorkspaceConfig, type Workspace, WorkspaceManager } from '@specmate/workspace'
import { type RunnerConfig, type RunnerOptions, resolveRunnerConfig } from '../src/config.ts'

export const STUB = join(import.meta.dir, 'stub-provider.ts')
export const ROLES_DIR = join(import.meta.dir, '..', '..', '..', 'roles')

/**
 * The backend scrubs the environment on purpose, so the stub's settings have to
 * be forwarded by name — the same mechanism that moves a provider from the
 * stored session to an API key.
 */
export const STUB_ENV = [
  'SPECMATE_STUB_MODE',
  'SPECMATE_STUB_MODE_FILE',
  'SPECMATE_STUB_SLUG',
  'SPECMATE_STUB_RECORD',
  'SPECMATE_STUB_ROLE',
  'SPECMATE_STUB_FINDING',
  'SPECMATE_STUB_VERDICT',
  'SPECMATE_STUB_MATRIX',
  'SPECMATE_STUB_HARNESS_CLASSIFICATION',
  'SPECMATE_STUB_SESSION',
]

/**
 * Cleared before every use: bun runs the suite in one process, so a queue file
 * left over from another test would otherwise decide this one's outcome.
 */
export function setStubEnv(values: Record<string, string>): void {
  for (const name of STUB_ENV) delete process.env[name]
  Object.assign(process.env, values)
}

const created: string[] = []

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `specmate-runner-${prefix}-`))
  created.push(dir)

  return dir
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

export function makeConfig(overrides: RunnerOptions = {}): RunnerConfig {
  return resolveRunnerConfig({
    backend: 'local',
    cli: STUB,
    rolesDir: ROLES_DIR,
    stageTimeoutMs: 20_000,
    ...overrides,
  })
}

export interface Harness {
  readonly workspace: Workspace
  readonly git: Git
  readonly manager: WorkspaceManager
  readonly originDir: string
  commitAll(message?: string): Promise<void>
}

/**
 * A real origin repository and a real worktree, on `file://` — the git paths
 * the runner depends on (diff, status, merge-base) are exercised for real, with
 * no network and no credential.
 */
export async function makeHarness(
  slug: string,
  files: Record<string, string> = {
    'README.md': '# origin\n',
    'src/app.ts': 'export const a = 1\n',
  },
): Promise<Harness> {
  const originDir = await tempDir('origin')
  const originGit = new Git(resolveWorkspaceConfig({ root: originDir }))
  await originGit.run(['init', '--quiet', '-b', 'main', originDir])
  await writeFiles(originDir, files)
  await originGit.run(['add', '-A'], { cwd: originDir })
  await originGit.run(['commit', '--quiet', '-m', 'init'], { cwd: originDir })

  const root = await tempDir('root')
  const manager = new WorkspaceManager({ config: { root } })
  const workspace = await manager.provision({
    slug,
    repoUrl: `file://${originDir}`,
    baseBranch: 'main',
  })
  const git = new Git(manager.config)

  return {
    workspace,
    git,
    manager,
    originDir,
    async commitAll(message = 'stage') {
      await git.run(['add', '-A'], { cwd: workspace.path })
      await git.run(['commit', '--quiet', '--no-verify', '-m', message], { cwd: workspace.path })
    },
  }
}
