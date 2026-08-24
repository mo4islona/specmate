import { commitUrl, shortCommit } from '../lib/repo-link.ts'

interface CommitRefProps {
  readonly sha: string
  readonly repoUrl: string
  readonly className?: string
}

/**
 * A 40-character hash tells the owner nothing; seven of it plus a way to open
 * the commit tells them everything they wanted from it. The full hash stays on
 * the element's title for copying.
 */
export function CommitRef({ sha, repoUrl, className = '' }: CommitRefProps) {
  const href = commitUrl(repoUrl, sha)
  const classes = `font-mono text-[0.68rem] text-muted ${className}`

  if (!href) {
    return (
      <span className={classes} title={sha}>
        {shortCommit(sha)}
      </span>
    )
  }

  return (
    <a
      className={`${classes} underline decoration-border-bright underline-offset-2 hover:text-accent`}
      href={href}
      title={sha}
      target="_blank"
      rel="noreferrer"
    >
      {shortCommit(sha)}
    </a>
  )
}
