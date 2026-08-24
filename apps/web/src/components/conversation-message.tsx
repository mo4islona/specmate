import type { ConversationMessage } from '../lib/api-client.ts'
import { formatClock } from '../lib/format.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

const AUTHORS: Record<ConversationMessage['role'], { label: string; tone: string }> = {
  owner: { label: 'you', tone: 'text-accent' },
  assistant: { label: 'guide', tone: 'text-info' },
  system: { label: 'system', tone: 'text-muted' },
}

/**
 * One turn of the task conversation, rendered as a transcript line rather than
 * a ledger row: who spoke, what they said, and — while a response is still
 * owed — that it is owed.
 */
export function ConversationMessageItem({ message }: { message: ConversationMessage }) {
  const isPending = message.status === 'queued' || message.status === 'responding'
  const author = AUTHORS[message.role]

  return (
    <li
      className={`py-2 ${isPending ? 'attention-pulse rounded-xl px-3' : ''}`}
      data-timeline-kind="conversation-message"
    >
      <div className="flex items-baseline gap-2">
        <span className={`micro-label ${author.tone}`}>{author.label}</span>
        <span className="font-mono text-[0.6rem] text-muted">
          at {message.taskState.replaceAll('_', ' ')}
        </span>
        <time
          className="ml-auto shrink-0 font-mono text-[0.62rem] text-muted"
          dateTime={String(message.createdAt)}
        >
          {formatClock(message.createdAt)}
        </time>
      </div>

      {message.contentMd && (
        <div className="artifact-document mt-1.5 text-sm">
          <ArtifactMarkdown content={message.contentMd} />
        </div>
      )}

      {isPending && (
        <p className="mt-2 flex items-center gap-2 font-mono text-xs text-attention" role="status">
          <span className="dot-live h-1.5 w-1.5 rounded-full bg-attention" aria-hidden="true" />
          {message.status === 'responding' ? 'Responding…' : 'Waiting for a response slot…'}
        </p>
      )}

      {message.status === 'failed' && (
        <p className="mt-2 text-sm text-danger">
          Response failed: {message.failureReason ?? 'no reason was recorded'}
        </p>
      )}
    </li>
  )
}
