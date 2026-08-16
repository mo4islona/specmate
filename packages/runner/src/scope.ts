import { type AgentRole, ROLE_CONTRACTS } from '@specmate/core'
import type { Git, Workspace } from '@specmate/workspace'

/**
 * What the filesystem shows is the authoritative statement of what a run did —
 * the tool restrictions handed to the CLI are defence in depth. The check runs
 * before the commit, so a role that wrote where it may not never has its output
 * recorded as legitimate work.
 */
export async function checkWriteScope(
  git: Git,
  workspace: Workspace,
  role: AgentRole,
): Promise<string[]> {
  if (ROLE_CONTRACTS[role].writesCode) return []

  // `-uall`: a fully untracked directory otherwise collapses to `dir/`, which
  // would flag a fresh change folder as product code on a task's first stage.
  const status = await git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: workspace.path,
  })
  const prefix = `${workspace.changeDir}/`

  return parseStatus(status.stdout).filter((path) => !path.startsWith(prefix))
}

/** `--porcelain=v1 -z`: NUL-separated, renames carry their source as the next field. */
function parseStatus(raw: string): string[] {
  const parts = raw.split('\0').filter((part) => part.length > 0)
  const paths: string[] = []
  let i = 0
  while (i < parts.length) {
    const entry = parts[i] ?? ''
    i += 1
    if (entry.startsWith('R') || entry.startsWith('C')) i += 1
    paths.push(entry.slice(3))
  }

  return paths
}
