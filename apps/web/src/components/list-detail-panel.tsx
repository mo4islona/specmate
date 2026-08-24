import type { ReactNode } from 'react'
import { ErrorState } from './query-state.tsx'

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
      <aside className="scroll-thin panel panel-flush rail-inset min-w-0 xl:overflow-y-auto">
        {sidebar}
      </aside>

      <section className="scroll-thin panel panel-flush min-w-0 overflow-hidden xl:overflow-y-auto">
        {!selectedId && (
          <div className="grid min-h-96 place-items-center p-6 text-center text-sm text-muted">
            {notSelectedLabel}
          </div>
        )}
        {selectedId && isPending && (
          <div className="grid min-h-96 place-items-center p-6 font-mono text-sm text-muted">
            {loadingLabel}
          </div>
        )}
        {selectedId && isError && (
          <div className="p-6">
            <ErrorState title={errorTitle} detail={error?.message ?? 'Request failed'} />
          </div>
        )}
        {selectedId && !isPending && !isError && children}
      </section>
    </div>
  )
}
