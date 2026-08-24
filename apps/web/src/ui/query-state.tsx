import { EmptyState, MicroLabel, Note } from './note.tsx'
import { Panel } from './panel.tsx'

interface QueryStateProps {
  readonly title: string
  readonly detail?: string
}

/** A pane waiting on its request, at the size the answer will take. */
export function LoadingState({ title }: QueryStateProps) {
  return (
    <Panel as="div" flush>
      <EmptyState mono>{title}</EmptyState>
    </Panel>
  )
}

/** A request that will not be answered, and what the server said about it. */
export function ErrorState({ title, detail }: QueryStateProps) {
  return (
    <Panel as="div" className="border-danger/35">
      <MicroLabel tone="danger">Request failed</MicroLabel>

      <h2 className="mt-2 text-lg font-semibold">{title}</h2>

      {detail && <Note className="mt-2">{detail}</Note>}
    </Panel>
  )
}
