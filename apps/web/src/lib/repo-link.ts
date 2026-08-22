const WEB_HOSTS: ReadonlySet<string> = new Set(['github.com', 'gitlab.com'])

interface RemoteRef {
  readonly host: string
  readonly path: string
}

/** Accepts both remote spellings git itself accepts: `https://host/owner/repo(.git)` and `git@host:owner/repo.git`. */
function parseRemote(repoUrl: string): RemoteRef | null {
  const trimmed = repoUrl.trim()
  const scp = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(trimmed)
  if (scp?.[1] && scp[2]) {
    return { host: scp[1], path: scp[2].replace(/\.git$/, '') }
  }

  try {
    const url = new URL(trimmed)

    return { host: url.host, path: url.pathname.replace(/^\//, '').replace(/\.git$/, '') }
  } catch {
    return null
  }
}

/** `owner/repo` — what the owner calls the repository, not the clone URL. */
export function repoLabel(repoUrl: string): string {
  return parseRemote(repoUrl)?.path ?? repoUrl
}

/** Null for a host whose web URL scheme we cannot know — a bad guess links nowhere. */
export function commitUrl(repoUrl: string, sha: string): string | null {
  const remote = parseRemote(repoUrl)
  if (!remote || !WEB_HOSTS.has(remote.host) || !/^[0-9a-f]{7,40}$/i.test(sha)) return null

  return `https://${remote.host}/${remote.path}/commit/${sha}`
}

export function shortCommit(sha: string): string {
  return sha.slice(0, 7)
}
