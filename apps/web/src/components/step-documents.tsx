import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { type ArtifactSummary, getArtifact } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { namedDocuments } from '../lib/task-documents.ts'
import { cn, Icon, MicroLabel, QuietLink, TextButton } from '../ui/index.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'
import { KickoffBrief } from './kickoff-brief.tsx'

interface StepDocumentsProps {
  readonly taskId: string
  readonly documents: readonly ArtifactSummary[]
  /**
   * True while the step being read is the one the task stands on — what the
   * owner is being asked about, and therefore open rather than shut.
   */
  readonly current: boolean
}

/** What a card can say about a document before anyone opens it. */
function sizeFact(content: string | null): string {
  if (content === null) return 'reading…'

  const body = content.trim()
  if (body.length === 0) return 'empty'

  const lines = body.split('\n').length

  return `${lines} ${lines === 1 ? 'line' : 'lines'}`
}

/**
 * What the step produced, at the end of the step (REQ-907, REQ-913). A gate
 * that asks for approval and shows nothing to approve is the confusion this
 * closes: the document being judged is on the screen doing the judging, not one
 * tab away.
 *
 * A short list of files, not a shelf of tiles. Rendering every artifact open
 * and full-length put a decision log reading `No decisions have been raised on
 * this task yet` on the screen at the same size as the proposal it followed,
 * and pushed the console under the fold to do it — so one opens at a time,
 * clamped. But the tiles that replaced them read as cards of something rather
 * than as documents: three lines apiece where a row of a list would do.
 *
 * A row is named for what the document is rather than for the file holding it.
 * It carried the file name — `proposal.md`, `decisions.md` — until it had to
 * hold for a repository whose spec convention is not OpenSpec's: `kind` is the
 * vocabulary every convention is mapped onto, and a shelf reading `proposal.md`
 * reads something else, or nothing at all, the moment the files are laid out
 * another way. The path is still what a specification is told apart by, since a
 * change holds one per capability — so that row, and only that row, carries it.
 */
export function StepDocuments({ taskId, documents, current }: StepDocumentsProps) {
  const contents = useQueries({
    queries: documents.map((document) => ({
      queryKey: queryKeys.artifact(taskId, document.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getArtifact(taskId, document.id, signal),
    })),
  })
  // `undefined` is "the owner has not touched this yet", which is not the same
  // as "the owner shut it" — only the first opens the step's own document.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)

  if (documents.length === 0) return null

  const named = namedDocuments(documents)
  // The queries are keyed to the props' order; the shelf draws in reading order.
  const contentById = new Map(
    documents.map((document, index) => [
      document.id,
      contents[index]?.data?.artifact.content ?? null,
    ]),
  )

  const openId = picked === undefined ? (current ? (named[0]?.artifact.id ?? null) : null) : picked
  const open = named.find((document) => document.artifact.id === openId) ?? null

  return (
    <section aria-label="What this step produced" className="mt-6">
      <MicroLabel as="h3">Produced here</MicroLabel>

      <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {named.map((document) => {
          const selected = document.artifact.id === openId

          return (
            <li key={document.artifact.id}>
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => setPicked(selected ? null : document.artifact.id)}
                title={document.artifact.path}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  selected ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/[0.04]',
                )}
              >
                <Icon
                  name="file"
                  className={selected ? 'text-foreground' : 'text-muted-foreground'}
                />
                <span className="shrink-0 text-[0.8rem] text-foreground">{document.name}</span>{' '}
                {document.qualifier !== null && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.66rem] text-muted-foreground">
                    {document.qualifier}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[0.62rem] text-muted-foreground">
                  {sizeFact(contentById.get(document.artifact.id) ?? null)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {open && (
        <DocumentReader
          key={open.artifact.id}
          taskId={taskId}
          document={open.artifact}
          content={contentById.get(open.artifact.id) ?? null}
        />
      )}
    </section>
  )
}

/**
 * One document, clamped. It expands in place rather than scrolling inside
 * itself: the column is one scrolling region, and a box with its own scrollbar
 * inside it is the fold this redesign spent a pass removing.
 */
function DocumentReader({
  taskId,
  document,
  content,
}: {
  taskId: string
  document: ArtifactSummary
  content: string | null
}) {
  const [whole, setWhole] = useState(false)
  const long = content !== null && content.trim().split('\n').length > 24

  return (
    <div data-document-open="" className="mt-3 rounded-xl bg-popover/45 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate font-mono text-[0.62rem] text-muted-foreground">
          {document.path}
        </p>

        <QuietLink href={`/tasks/${taskId}/docs/${document.id}`} className="shrink-0">
          open on Docs ↗
        </QuietLink>
      </div>

      {content === null ? (
        <p className="pt-2 font-mono text-[0.68rem] text-muted-foreground">Reading the document…</p>
      ) : (
        <div className={cn('relative pt-2', long && !whole && 'max-h-96 overflow-hidden')}>
          {document.kind === 'proposal' ? (
            <KickoffBrief content={content} />
          ) : (
            <div className="artifact-document text-sm">
              <ArtifactMarkdown content={content} />
            </div>
          )}

          {long && !whole && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-popover to-transparent" />
          )}
        </div>
      )}

      {long && (
        <TextButton className="mt-1" onClick={() => setWhole(!whole)}>
          {whole ? 'clamp it back' : 'read the whole thing →'}
        </TextButton>
      )}
    </div>
  )
}
