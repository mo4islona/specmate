import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { WorkspaceConfig } from './config.ts'
import { isDirectory } from './fs.ts'
import type { Git } from './git.ts'
import { mirrorPath, RESULT_FILE, type RepositoryRef, SCRATCH_DIR } from './paths.ts'

export class BaseBranchMissingError extends Error {
  constructor(
    readonly repoUrl: string,
    readonly baseBranch: string,
  ) {
    super(`base branch "${baseBranch}" does not exist on ${repoUrl}`)
    this.name = 'BaseBranchMissingError'
  }
}

export class DefaultBranchUnknownError extends Error {
  constructor(readonly repoUrl: string) {
    super(`${repoUrl} reports no default branch`)
    this.name = 'DefaultBranchUnknownError'
  }
}

const EXCLUDE_MARKER = '# specmate: runner scratch'

/**
 * What a stage commit must never pick up, over and above the repository's own
 * `.gitignore` — which covers what its authors see on their own machines, and
 * therefore not what only the runner produces.
 *
 * Nothing here can take anything away from a repository that wants it: an
 * exclude pattern says nothing about a path git already tracks.
 */
const EXCLUDED = [
  // Anchored: both are written at the worktree root, and a repository with its
  // own `RESULT.json` somewhere in a tree is not ours to hide.
  `/${RESULT_FILE}`,
  `/${SCRATCH_DIR}/`,
  // pnpm hardlinks out of its store, so it relocates the store beside the
  // project whenever the default one is on another filesystem — which, for a
  // worktree mounted into a container, is exactly what a default HOME is.
  '.pnpm-store/',
  'node_modules/',
  // A crash drops its core next to whatever was running, and a core is large.
  'core.[0-9]*',
]

/**
 * The local cache is a bare repository whose remote heads live under
 * `refs/remotes/origin/*`, leaving `refs/heads/*` to us. A `--mirror` clone
 * would put the remote's heads there instead, and the pruning fetch we run on
 * every provisioning would then delete every task branch the remote has never
 * heard of — which is all of them.
 */
export async function ensureMirror(
  git: Git,
  config: WorkspaceConfig,
  repository: RepositoryRef,
): Promise<string> {
  const { repoUrl } = repository
  const path = mirrorPath(config, repository.mirrorKey)
  const auth = await git.authEnv(repoUrl)
  if (await isDirectory(join(path, 'objects'))) {
    await git.inMirror(path, ['remote', 'set-url', 'origin', repoUrl])
    await git.inMirror(path, ['fetch', 'origin', '--prune', '--quiet'], { env: auth })

    return path
  }

  await sweepTemporaries(path)
  const temporary = `${path}.tmp-${randomUUID().slice(0, 8)}`
  try {
    await mkdir(dirname(path), { recursive: true })
    await git.run(['init', '--bare', '--quiet', temporary])
    await git.inMirror(temporary, ['remote', 'add', 'origin', repoUrl])
    await git.inMirror(temporary, ['fetch', 'origin', '--prune', '--quiet'], { env: auth })
    // The mirror path exists only once it is complete: a clone killed half-way
    // leaves a temporary directory, never something a later run mistakes for a
    // usable cache.
    await rename(temporary, path)
  } catch (e) {
    await rm(temporary, { recursive: true, force: true })

    throw e
  }

  return path
}

async function sweepTemporaries(path: string): Promise<void> {
  const parent = dirname(path)
  const prefix = `${basename(path)}.tmp-`
  const entries = await readdir(parent).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => rm(join(parent, entry), { recursive: true, force: true })),
  )
}

export async function resolveBaseCommit(
  git: Git,
  mirror: string,
  repoUrl: string,
  baseBranch: string,
): Promise<string> {
  const ref = `refs/remotes/origin/${baseBranch}`
  const result = await git.tryInMirror(mirror, ['rev-parse', '--verify', '--quiet', ref])
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new BaseBranchMissingError(repoUrl, baseBranch)
  }

  return result.stdout.trim()
}

/**
 * The branch a task runs against when it named none (REQ-703). A plain fetch
 * leaves `refs/remotes/origin/HEAD` unset, so the symref is asked for
 * explicitly — one `ls-remote` against the forge, paid only by a task that
 * needs it.
 */
export async function resolveDefaultBranch(
  git: Git,
  mirror: string,
  repoUrl: string,
): Promise<string> {
  const auth = await git.authEnv(repoUrl)
  await git.tryInMirror(mirror, ['remote', 'set-head', 'origin', '--auto'], { env: auth })

  const result = await git.tryInMirror(mirror, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  const head = result.exitCode === 0 ? result.stdout.trim() : ''
  const branch = head.startsWith('origin/') ? head.slice('origin/'.length) : ''

  // A conventional name here would be a fallback that hides a broken remote —
  // exactly what AC-708 refuses for a branch the owner did name.
  if (!branch) throw new DefaultBranchUnknownError(repoUrl)

  return branch
}

/**
 * `info/exclude` lives in the shared repository and applies to every worktree
 * cut from it, so the scratch rules are written once per target repository —
 * and the repository's own `.gitignore`, which a human reviews, stays ours to
 * leave alone.
 *
 * The block is rewritten rather than written once. Skipping a mirror that
 * already carried the marker meant every repository SpecMate had ever cloned
 * kept whichever list it was first given, so a rule added after a bad commit
 * only ever protected repositories nobody had used yet.
 */
export async function ensureExcludes(mirror: string): Promise<void> {
  const infoDir = join(mirror, 'info')
  const excludePath = join(infoDir, 'exclude')
  const existing = await readFile(excludePath, 'utf8').catch(() => '')

  const block = `${EXCLUDE_MARKER} — never part of a stage commit\n${EXCLUDED.join('\n')}\n`
  const kept = withoutManagedBlock(existing).trimEnd()

  await mkdir(infoDir, { recursive: true })
  await writeFile(excludePath, kept ? `${kept}\n\n${block}` : block)
}

/**
 * Everything from our marker on. The block is always written last, so its
 * marker is the cut — which is what lets a block written by an older version,
 * under no end fence, be replaced rather than duplicated.
 */
function withoutManagedBlock(contents: string): string {
  const marker = contents.indexOf(EXCLUDE_MARKER)

  return marker === -1 ? contents : contents.slice(0, marker)
}
