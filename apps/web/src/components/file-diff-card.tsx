import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { type DiffFileSummary, getFileDiff, getWholeFileDiff } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import {
  Checkbox,
  cx,
  Diff,
  type DiffView,
  ErrorState,
  LoadingState,
  Note,
  Subpanel,
  TextButton,
} from '../ui/index.ts'
import { FileStatus, StatCounts } from './diff-file-facts.tsx'

/**
 * Past this many lines a diff stops being a card in a stack and becomes the
 * page. The rest is one click away, which keeps the file after it reachable by
 * scrolling rather than by scrolling past a thousand lines.
 */
const CLAMP_LINES = 300

interface FileDiffCardProps {
  readonly taskId: string
  readonly file: DiffFileSummary
  readonly open: boolean
  readonly onToggle: () => void
  readonly viewed: boolean
  readonly onViewedChange: (viewed: boolean) => void
  readonly view: DiffView
}

/**
 * One file of the pass: its facts, its tick, and its diff — fetched when the
 * card is open and not before, because a fifty-file task would otherwise open
 * fifty reads to draw a screen showing three.
 */
export function FileDiffCard({
  taskId,
  file,
  open,
  onToggle,
  viewed,
  onViewedChange,
  view,
}: FileDiffCardProps) {
  const [showWhole, setShowWhole] = useState(false)
  const [wholeFileWanted, setWholeFileWanted] = useState(false)

  const diff = useQuery({
    queryKey: queryKeys.diffFile(taskId, file.path),
    queryFn: ({ signal }) => getFileDiff(taskId, file.path, signal),
    enabled: open,
  })

  const wholeFile = useQuery({
    queryKey: queryKeys.wholeFileDiff(taskId, file.path),
    queryFn: ({ signal }) => getWholeFileDiff(taskId, file.path, signal),
    enabled: open && wholeFileWanted,
  })

  const lines = diff.data ? diff.data.diff.split('\n') : []
  const clamped = lines.length > CLAMP_LINES && !showWhole

  return (
    // Named, because a stack of them puts a dozen `Viewed` ticks on one page
    // and "which file?" is the only question that tells them apart.
    <Subpanel as="section" aria-label={file.path} className="min-w-0" id={cardId(file.path)}>
      <header
        className={cx(
          'flex min-w-0 flex-wrap items-center justify-between gap-3',
          open && 'border-border/60 border-b pb-2.5',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${file.path}`}
          className="-mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-muted transition-colors hover:bg-text/[0.07] hover:text-text"
        >
          <span
            aria-hidden="true"
            className={cx('text-[0.7rem] transition-transform', open && 'rotate-90')}
          >
            ▶
          </span>
          <span className="min-w-0 truncate font-mono text-text text-xs">{file.path}</span>
        </button>

        <div className="flex shrink-0 items-center gap-4">
          <FileStatus file={file} />
          <StatCounts file={file} bar />

          <Checkbox
            label="Viewed"
            checked={viewed}
            onChange={(event) => onViewedChange(event.target.checked)}
          />
        </div>
      </header>

      {open && (
        <div className="mt-3 min-w-0">
          {diff.isPending && <LoadingState title="Loading diff…" shape="code" />}
          {diff.isError && <ErrorState title="Diff unavailable" detail={diff.error.message} />}

          {diff.data &&
            (diff.data.diff.trim() === '' ? (
              <Note className="p-4">
                This task's comparison has nothing for this file — it was changed inside a run whose
                work was never committed, or it has since been changed back.
              </Note>
            ) : (
              <>
                <Diff
                  diff={clamped ? lines.slice(0, CLAMP_LINES).join('\n') : diff.data.diff}
                  view={view}
                  fileHeader={false}
                  lineNumbers
                  wholeFile={wholeFile.data?.diff}
                  onWholeFileNeeded={() => setWholeFileWanted(true)}
                />

                {clamped && (
                  <p className="mt-2 text-muted text-xs">
                    Clamped to the first {CLAMP_LINES} of {lines.length} lines.{' '}
                    <TextButton onClick={() => setShowWhole(true)}>Draw the rest</TextButton>
                  </p>
                )}
              </>
            ))}
        </div>
      )}
    </Subpanel>
  )
}

/** Stable per path, so selecting a file in the tree can bring its card into view. */
export function cardId(path: string): string {
  return `file-card-${path.replace(/[^a-zA-Z0-9]/g, '-')}`
}
