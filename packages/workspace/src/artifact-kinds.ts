import type { ArtifactKind } from '@specmate/core'

/**
 * Path → artifact kind, for paths relative to the change folder. The catalog is
 * a closed enum shared with the database; a file that matches nothing is left
 * unindexed rather than filed under an invented kind.
 */
export function artifactKindForPath(relativePath: string): ArtifactKind | null {
  const path = relativePath.replace(/^\/+/, '').toLowerCase()
  if (!path.endsWith('.md')) return null
  if (path.startsWith('specs/')) return 'spec'
  switch (path) {
    case 'proposal.md':
      return 'proposal'
    case 'design.md':
      return 'design'
    case 'tasks.md':
      return 'tasks'
    case 'review.md':
      return 'review'
    case 'verification.md':
      return 'verification'
    case 'summary.md':
      return 'summary'
    case 'decisions.md':
      return 'decision_log'
    default:
      return path.startsWith('review/') ? 'review' : null
  }
}
