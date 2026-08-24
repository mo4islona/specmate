/**
 * The identity of a repository, independent of how a remote spells it:
 * `git@host:org/repo.git` and `https://host/org/repo` are one repository. Anything
 * keyed per repository — a mirror, a coverage waiver, a spec convention — keys on
 * this, so a setting cannot miss on spelling and read as absent.
 */
export function normalizeRemote(repoUrl: string): string {
  const trimmed = repoUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]+@/, '')

  return withoutScheme.replace(':', '/').toLowerCase()
}
