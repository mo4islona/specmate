import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { cardId, FileDiffCard } from '../components/file-diff-card.tsx'
import { FileList } from '../components/file-tree.tsx'
import { type DiffFileSummary, listDiffFiles } from '../lib/api-client.ts'
import { groupByDirectory } from '../lib/diff-tree.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { readDiffView, readPass, storeDiffView, writePass } from '../lib/review-store.ts'
import {
  Button,
  type DiffView,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Meter,
  MicroLabel,
  Note,
  Panel,
  TextButton,
} from '../ui/index.ts'

/** Code first: it is what a reviewer opens the view for once there is any. */
const GROUPS = [
  { id: 'code', label: 'Code' },
  { id: 'spec', label: 'Specification' },
] as const

/**
 * The stack reads in the order the tree draws — code before specification,
 * then by path. Left in the comparison's own order, `openspec/` sorts above
 * `src/` and the reader lands on the change folder every time.
 */
function inTreeOrder(files: readonly DiffFileSummary[]): DiffFileSummary[] {
  const rank = (file: DiffFileSummary) => GROUPS.findIndex((group) => group.id === file.group)

  return [...files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

/**
 * How many files arrive already open. Enough that the surface reads as a diff
 * rather than as a list of headers, few enough that opening it is a handful of
 * reads and not one per file.
 */
const INITIALLY_OPEN = 3

/** Below this the two columns of a split diff have nothing to be wide in. */
const SPLIT_QUERY = '(min-width: 62rem)'

function useWideEnoughToSplit(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true

    return window.matchMedia(SPLIT_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(SPLIT_QUERY)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)

    return () => query.removeEventListener('change', sync)
  }, [])

  return wide
}

interface FilesChangedScreenProps {
  taskId: string
}

export function FilesChangedScreen({ taskId }: FilesChangedScreenProps) {
  const files = useQuery({
    queryKey: queryKeys.diffFiles(taskId),
    queryFn: ({ signal }) => listDiffFiles(taskId, signal),
  })

  if (files.isPending) {
    return <LoadingState title="Computing the task's diff…" shape="rows" />
  }
  if (files.isError) {
    return <ErrorState title="Diff unavailable" detail={files.error.message} />
  }

  if (files.data.files.length === 0) {
    return (
      <Panel as="div" flush>
        <EmptyState>This task has not committed any changes yet.</EmptyState>
      </Panel>
    )
  }

  // Keyed by the comparison: a task that commits mid-review is a different diff
  // and therefore a different pass, read fresh from storage (REQ-916/AC-1800).
  return (
    <FilesReview
      key={files.data.tip}
      taskId={taskId}
      tip={files.data.tip}
      files={inTreeOrder(files.data.files)}
    />
  )
}

interface FilesReviewProps {
  readonly taskId: string
  readonly tip: string
  readonly files: readonly DiffFileSummary[]
}

function FilesReview({ taskId, tip, files }: FilesReviewProps) {
  const [pass] = useState(() => readPass(taskId, tip))
  const [viewed, setViewed] = useState<ReadonlySet<string>>(pass.paths)
  const [moved, setMoved] = useState(pass.moved)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(files.slice(0, INITIALLY_OPEN).map((file) => file.path)),
  )
  const [view, setView] = useState<DiffView>(readDiffView)

  const wideEnoughToSplit = useWideEnoughToSplit()
  const effectiveView = wideEnoughToSplit ? view : 'unified'

  // The stale pass has been reported; leave the current comparison's own empty
  // pass behind it, so the notice is shown once rather than on every visit.
  useEffect(() => {
    if (pass.moved) writePass(taskId, tip, new Set())
  }, [pass.moved, taskId, tip])

  const needle = filter.trim().toLowerCase()
  const shown = needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files

  const markViewed = (path: string, isViewed: boolean) => {
    const next = new Set(viewed)
    if (isViewed) next.add(path)
    else next.delete(path)

    setViewed(next)
    writePass(taskId, tip, next)
  }

  const select = (file: DiffFileSummary) => {
    setSelected(file.path)
    setOpen((current) => new Set(current).add(file.path))
    // jsdom has no layout and therefore no scrolling; the selection still holds.
    document.getElementById(cardId(file.path))?.scrollIntoView?.({ block: 'start' })
  }

  const chooseView = (next: DiffView) => {
    setView(next)
    storeDiffView(next)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Meter
            done={viewed.size}
            total={files.length}
            label="Files viewed"
            className="w-24 shrink-0"
          />
          <p className="whitespace-nowrap text-xs">
            <span className="font-mono">
              {viewed.size} / {files.length}
            </span>{' '}
            <span className="text-muted-foreground">viewed</span>
          </p>
        </div>

        {wideEnoughToSplit && (
          <div className="flex items-center gap-1">
            <Button
              variant={view === 'unified' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'unified'}
              onClick={() => chooseView('unified')}
              className="min-h-8 py-1"
            >
              Unified
            </Button>
            <Button
              variant={view === 'split' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'split'}
              onClick={() => chooseView('split')}
              className="min-h-8 py-1"
            >
              Split
            </Button>
          </div>
        )}
      </div>

      {moved && (
        <Note className="flex shrink-0 flex-wrap items-baseline justify-between gap-3 p-4">
          <span>
            This task has committed since these files were marked, so the pass started again — the
            marks described a diff that no longer exists.
          </span>
          <TextButton onClick={() => setMoved(false)}>Dismiss</TextButton>
        </Note>
      )}

      {/* The listing stays put while the stack moves under it — a file list
          that rides away from the diff it belongs to is a list you scroll back
          up to. It is sticky rather than a pane of its own because the task
          column only has a height of its own past `xl`, and below that an
          `overflow` on an automatic height is no overflow at all. The stack
          takes the pane treatment `ListDetailPanel` uses, at the width where
          that height exists. */}
      <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel
          as="div"
          flush
          className="flex min-w-0 flex-col self-start overflow-hidden lg:sticky lg:top-0 lg:max-h-screen"
        >
          <div className="rail-inset border-b border-border">
            <Input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter files"
              aria-label="Filter files"
            />
          </div>

          <div className="scroll-thin rail-inset min-h-0 min-w-0 flex-1 overflow-y-auto">
            {shown.length === 0 && <Note size="xs">No file's path matches that.</Note>}

            <nav aria-label="Changed files" className="min-w-0">
              {GROUPS.map((group) => {
                const groupFiles = shown.filter((file) => file.group === group.id)
                if (groupFiles.length === 0) return null

                return (
                  <section key={group.id} className="mt-5 min-w-0 first:mt-0">
                    <MicroLabel>
                      {group.label} · {groupFiles.length}
                    </MicroLabel>

                    <FileList
                      groups={groupByDirectory(groupFiles)}
                      selected={selected}
                      viewed={viewed}
                      onSelect={select}
                    />
                  </section>
                )
              })}
            </nav>
          </div>
        </Panel>

        <div className="scroll-thin min-w-0 space-y-3 xl:overflow-y-auto">
          {shown.map((file) => (
            <FileDiffCard
              key={file.path}
              taskId={taskId}
              file={file}
              open={open.has(file.path)}
              onToggle={() =>
                setOpen((current) => {
                  const next = new Set(current)
                  if (!next.delete(file.path)) next.add(file.path)

                  return next
                })
              }
              viewed={viewed.has(file.path)}
              onViewedChange={(isViewed) => markViewed(file.path, isViewed)}
              view={effectiveView}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
