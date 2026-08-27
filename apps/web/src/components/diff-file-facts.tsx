import type { DiffFileSummary } from '../lib/api-client.ts'
import { MicroLabel, StatBar, type Tone } from '../ui/index.ts'

/**
 * Only the two the counts cannot say. `modified` is what a file in a diff is
 * unless told otherwise, and `added` is `−0` — a word for either is a column of
 * noise down a stack of files, repeating what the numbers beside it just said.
 */
const NAMED_STATUS: Partial<Record<DiffFileSummary['status'], { label: string; tone: Tone }>> = {
  deleted: { label: 'deleted', tone: 'destructive' },
  'type-changed': { label: 'type changed', tone: 'warning' },
}

/** What happened to a file, where that is not already on the row. */
export function FileStatus({ file }: { file: DiffFileSummary }) {
  const status = NAMED_STATUS[file.status]
  if (!status) return null

  return (
    <MicroLabel as="span" tone={status.tone}>
      {status.label}
    </MicroLabel>
  )
}

/**
 * A file's weight in the comparison. Null counts are git's answer for a binary
 * file, which has a size but no lines — saying `+0 -0` would be a lie.
 */
export function StatCounts({
  file,
  bar = false,
}: {
  readonly file: DiffFileSummary
  /** The five blocks beside the numbers. Off where the row is already crowded. */
  readonly bar?: boolean
}) {
  if (file.additions === null || file.deletions === null) {
    return <span className="font-mono text-[0.65rem] text-muted-foreground">binary</span>
  }

  return (
    <span className="flex shrink-0 items-center gap-2.5 font-mono text-[0.65rem]">
      {/* A zero is not a change, so it does not wear a change's colour. Every
          added file carries a `−0`, and in danger red a stack of them read as a
          column of losses down a rail where nothing had been lost. */}
      <span className="whitespace-nowrap">
        <span className={file.additions > 0 ? 'text-success' : 'text-muted-foreground'}>
          +{file.additions}
        </span>{' '}
        <span className={file.deletions > 0 ? 'text-destructive' : 'text-muted-foreground'}>
          −{file.deletions}
        </span>
      </span>
      {bar && <StatBar additions={file.additions} deletions={file.deletions} />}
    </span>
  )
}
