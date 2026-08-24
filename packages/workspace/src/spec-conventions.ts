import { isAbsolute, join, normalize, relative } from 'node:path'
import { OPENSPEC_SUITE_PATH, type SpecConventionTree } from '@specmate/core'
import { isDirectory } from './fs.ts'

/**
 * What the checked-out tree answers about its own specification (REQ-1702).
 *
 * `expected` is the path the owner's setting looks for; it is checked only where a
 * setting configures one of its own. The OpenSpec case is answered by
 * `hasOpenspecSuite` whether or not a setting named it, so both readings of the tree
 * come from one place.
 */
export async function readSpecConventionTree(
  workspacePath: string,
  expected: string | null,
): Promise<SpecConventionTree> {
  const hasOpenspecSuite = await isDirectory(join(workspacePath, OPENSPEC_SUITE_PATH))

  const configured = expected !== null && expected !== OPENSPEC_SUITE_PATH ? expected : null
  if (configured === null) {
    return { hasOpenspecSuite, hasConfiguredSuite: null }
  }

  const resolved = suitePathWithin(workspacePath, configured)
  const hasConfiguredSuite = resolved === null ? false : await isDirectory(resolved)

  return { hasOpenspecSuite, hasConfiguredSuite }
}

/**
 * A configured suite is a path inside the working tree. Anything absolute or climbing
 * out of it reads as absent rather than as a directory somewhere on the host: the
 * setting points at a repository's own specification, never at the machine running it.
 */
export function suitePathWithin(workspacePath: string, candidate: string): string | null {
  if (isAbsolute(candidate)) return null

  const resolved = join(workspacePath, normalize(candidate))
  const inside = relative(workspacePath, resolved)
  if (inside === '' || inside.startsWith('..')) return null

  return resolved
}
