import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { type ArtifactSummary, getArtifact } from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { cx, MicroLabel, QuietLink, TextButton } from '../ui/index.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'
import { FileIcon } from './icons.tsx'
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

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
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
 * than as documents: the kind was set biggest and brightest and the file name
 * came third, in the page's own face. A file says it is a file with a page
 * glyph and a name in the mono face every other path in this app is set in.
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

  const openId = picked === undefined ? (current ? (documents[0]?.id ?? null) : null) : picked
  const openIndex = documents.findIndex((document) => document.id === openId)
  const open = openIndex === -1 ? null : documents[openIndex]
  const openContent =
    openIndex === -1 ? null : (contents[openIndex]?.data?.artifact.content ?? null)

  return (
    <section aria-label="What this step produced" className="mt-6">
      <MicroLabel as="h3">Produced here</MicroLabel>

      <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
        {documents.map((document, index) => {
          const selected = document.id === openId

          return (
            <li key={document.id}>
              <button
                type="button"
                aria-expanded={selected}
                onClick={() => setPicked(selected ? null : document.id)}
                className={cx(
                  'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  selected ? 'bg-text/[0.07]' : 'hover:bg-text/[0.04]',
                )}
              >
                <FileIcon
                  className={cx('h-3.5 w-3.5 shrink-0', selected ? 'text-info' : 'text-muted')}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-text">
                  {fileName(document.path)}
                </span>
                <span className="flex shrink-0 items-baseline gap-2 font-mono text-[0.62rem] text-muted">
                  <span>{document.kind.replaceAll('_', ' ')}</span>
                  <span className="text-border-bright">·</span>
                  <span>{sizeFact(contents[index]?.data?.artifact.content ?? null)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {open && (
        <DocumentReader key={open.id} taskId={taskId} document={open} content={openContent} />
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
    <div data-document-open="" className="mt-3 rounded-xl bg-elevated/45 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate font-mono text-[0.62rem] text-muted">{document.path}</p>

        <QuietLink href={`/tasks/${taskId}/docs/${document.id}`} className="shrink-0">
          open on Docs ↗
        </QuietLink>
      </div>

      {content === null ? (
        <p className="pt-2 font-mono text-[0.68rem] text-muted">Reading the document…</p>
      ) : (
        <div className={cx('relative pt-2', long && !whole && 'max-h-96 overflow-hidden')}>
          {document.kind === 'proposal' ? (
            <KickoffBrief content={content} />
          ) : (
            <div className="artifact-document text-sm">
              <ArtifactMarkdown content={content} />
            </div>
          )}

          {long && !whole && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-elevated to-transparent" />
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
