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

/** The repository as a person opens it. Null for a host we cannot address over the web. */
export function repoWebUrl(repoUrl: string): string | null {
  const remote = parseRemote(repoUrl)
  if (!remote || !WEB_HOSTS.has(remote.host)) return null

  return `https://${remote.host}/${remote.path}`
}

/** `#412` — what a pull request is called, taken from the end of its own URL. */
export function pullRequestNumber(url: string): string | null {
  const number = /\/(?:pull|merge_requests)\/(\d+)/.exec(url)?.[1]

  return number ? `#${number}` : null
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

/**
 * AC-960: one fact per surface, never both. The thread and the documents are
 * about a repository on a branch; the changed files are about a comparison.
 * The repository itself is the same on every surface and is named beside this,
 * as a link — only the ref it is read at belongs here.
 */
export function surfaceRef(
  surface: 'thread' | 'files' | 'docs',
  baseBranch: string | null,
): string {
  // Null until provisioning resolved the repository's default (REQ-703).
  const base = baseBranch ?? 'default branch'

  return surface === 'files' ? `${base} … head` : base
}
