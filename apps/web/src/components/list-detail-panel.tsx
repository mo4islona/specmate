import type { ReactNode } from 'react'
import { EmptyState, ErrorState, Panel, SkeletonText, Waiting } from '../ui/index.ts'

interface ListDetailPanelProps {
  sidebar: ReactNode
  selectedId: string | null | undefined
  isPending: boolean
  isError: boolean
  error?: Error | null
  notSelectedLabel: string
  loadingLabel: string
  errorTitle: string
  children?: ReactNode
}

/**
 * The two-pane list/detail shell shared by the artifacts and files-changed
 * screens: a selectable sidebar list next to a detail pane that walks the
 * same not-selected → loading → error → data states either way. Only the
 * list rows and the loaded detail content are screen-specific.
 */
export function ListDetailPanel({
  sidebar,
  selectedId,
  isPending,
  isError,
  error,
  notSelectedLabel,
  loadingLabel,
  errorTitle,
  children,
}: ListDetailPanelProps) {
  return (
    // Each pane scrolls inside itself, because the column these sit in is as
    // tall as the viewport and no taller. Left to overflow, a long document was
    // simply cut off at the panel's own `overflow-hidden` with no way down.
    <div className="grid min-h-0 min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:h-full">
      <Panel
        as="aside"
        flush
        className="scroll-thin p-[var(--rail-gutter)] min-w-0 xl:overflow-y-auto"
      >
        {sidebar}
      </Panel>

      <Panel flush className="scroll-thin min-w-0 overflow-hidden xl:overflow-y-auto">
        {!selectedId && <EmptyState height="lg">{notSelectedLabel}</EmptyState>}

        {/* The pane waits as the document it is about to hold. It cannot borrow
            `LoadingState` for that: this is already inside the panel, and a
            second frame drawn inside the first is how the wait stopped looking
            like the answer. */}
        {selectedId && isPending && (
          <Waiting label={loadingLabel} className="space-y-7 p-4 sm:p-6">
            <SkeletonText lines={4} />
            <SkeletonText lines={3} />
            <SkeletonText lines={5} />
          </Waiting>
        )}

        {selectedId && isError && (
          <div className="p-6">
            <ErrorState title={errorTitle} detail={error?.message ?? 'Request failed'} />
          </div>
        )}

        {selectedId && !isPending && !isError && children}
      </Panel>
    </div>
  )
}
