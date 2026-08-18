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
    <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="panel min-w-0 p-3">{sidebar}</aside>

      <section className="panel min-w-0 overflow-hidden">
        {!selectedId && (
          <div className="grid min-h-96 place-items-center p-8 text-center text-sm text-muted">
            {notSelectedLabel}
          </div>
        )}
        {selectedId && isPending && (
          <div className="grid min-h-96 place-items-center p-8 font-mono text-sm text-muted">
            {loadingLabel}
          </div>
        )}
        {selectedId && isError && (
          <div className="p-5">
            <ErrorState title={errorTitle} detail={error?.message ?? 'Request failed'} />
          </div>
        )}
        {selectedId && !isPending && !isError && children}
      </section>
    </div>
  )
}
