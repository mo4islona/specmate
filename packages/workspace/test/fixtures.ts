import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SpecLayout } from '@specmate/core'
import {
  detectToolchains,
  type EnvironmentResolver,
  Git,
  type ProvisionRequest,
  resolveWorkspaceConfig,
  type Workspace,
  WorkspaceManager,
  type WorkspaceOptions,
} from '../src/index.ts'

export const resolveTestEnvironment: EnvironmentResolver = async (workspace, image) => ({
  image,
  toolchains: (await detectToolchains(workspace.path)).map((toolchain) => {
    if (!toolchain.version) throw new Error(`test toolchain ${toolchain.name} has no version`)

    return { name: toolchain.name, version: toolchain.version }
  }),
})

/** Locks tuned down so takeover tests finish in milliseconds, not minutes. */
export const FAST_LOCKS = {
  lockHeartbeatMs: 50,
  lockStaleMs: 200,
  lockWaitMs: 5_000,
} as const satisfies WorkspaceOptions

const created: string[] = []

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `specmate-${prefix}-`))
  created.push(dir)
  return dir
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

export interface Origin {
  readonly dir: string
  readonly url: string
  readonly branch: string
  readonly git: Git
  head(branch?: string): Promise<string>
  commit(files: Record<string, string>, message?: string): Promise<string>
}

export async function makeOrigin(
  files: Record<string, string> = { 'README.md': '# origin\n' },
  branch = 'main',
): Promise<Origin> {
  const dir = await tempDir('origin')
  const git = new Git(resolveWorkspaceConfig({ root: dir }))
  await git.run(['init', '--quiet', '-b', branch, dir])

  const origin: Origin = {
    dir,
    url: `file://${dir}`,
    branch,
    git,
    async head(ref = branch) {
      const result = await git.run(['rev-parse', ref], { cwd: dir })
      return result.stdout.trim()
    },
    async commit(contents, message = 'change') {
      await writeFiles(dir, contents)
      await git.run(['add', '-A'], { cwd: dir })
      await git.run(['commit', '--quiet', '-m', message], { cwd: dir })
      return origin.head()
    },
  }

  await origin.commit(files, 'init')
  return origin
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

/**
 * The two steps `WorkspaceService` takes for a task — provision the tree, then open the
 * change folder under the layout the task is pinned to — for a test that wants the
 * workspace rather than the tree.
 */
export async function provisionWorkspace(
  manager: WorkspaceManager,
  request: ProvisionRequest,
  options: { layout?: SpecLayout; changeName?: string | null } = {},
): Promise<Workspace> {
  const tree = await manager.provision(request)

  return manager.openChangeFolder(tree, options.layout ?? 'repository', options.changeName)
}

export async function makeManager(
  overrides: WorkspaceOptions = {},
): Promise<{ manager: WorkspaceManager; root: string }> {
  const root = await tempDir('root')
  const manager = new WorkspaceManager({ config: { root, ...FAST_LOCKS, ...overrides } })
  return { manager, root }
}
