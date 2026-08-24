import { pullRequestNumber, repoLabel, repoWebUrl } from '../lib/repo-link.ts'
import { PullRequestIcon, RepoIcon } from './icons.tsx'

/** What the task opened against the repository, once it has opened one. */
export interface PullRequestRef {
  readonly url: string
  readonly state: string
  readonly checksState: string | null
}

interface RepoRefProps {
  readonly repoUrl: string
  /** The ref the surface reads the repository at (`main`, `main … head`). */
  readonly ref: string
  readonly pullRequest?: PullRequestRef | null
}

const PR_TONE: Record<string, string> = {
  open: 'text-accent',
  merged: 'text-info',
  closed: 'text-muted',
}

/**
 * The repository, as somewhere to go rather than a string to read. It sat at
 * the end of the navigation row as plain text — the one identifier on the
 * screen that names a real place and the only one that was not a link. The
 * pull request joins it there, because "is it up yet, and did it pass" is the
 * question asked of a finished task.
 */
export function RepoRef({ repoUrl, ref, pullRequest = null }: RepoRefProps) {
  const label = repoLabel(repoUrl)
  const href = repoWebUrl(repoUrl)
  const number = pullRequest ? (pullRequestNumber(pullRequest.url) ?? 'pull request') : null

  return (
    <p className="flex min-w-0 items-center gap-x-2 pb-2 font-mono text-[0.62rem] text-muted">
      <span className="flex min-w-0 items-center gap-1.5">
        <RepoIcon className="h-3 w-3 shrink-0 opacity-70" />

        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="truncate text-info hover:underline"
          >
            {label}
          </a>
        ) : (
          <span className="truncate">{label}</span>
        )}

        <span className="shrink-0 text-muted">· {ref}</span>
      </span>

      {pullRequest && number && (
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          title={`${pullRequest.url} — ${pullRequest.state}${
            pullRequest.checksState ? `, checks ${pullRequest.checksState}` : ''
          }`}
          className={`flex shrink-0 items-center gap-1 rounded-md bg-text/[0.06] px-1.5 py-[0.1rem] hover:bg-text/10 ${
            PR_TONE[pullRequest.state] ?? 'text-muted'
          }`}
        >
          <PullRequestIcon className="h-3 w-3" />
          {number}
        </a>
      )}
    </p>
  )
}
