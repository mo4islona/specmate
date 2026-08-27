import type { ConversationMessage } from '../lib/api-client.ts'
import { formatClock } from '../lib/format.ts'
import { cn, Dot, MicroLabel } from '../ui/index.ts'
import { ArtifactMarkdown } from './artifact-markdown.tsx'
import { signalDot, signalText } from './tone.ts'

/** Three speakers, told apart by the word rather than by a hue each. */
const AUTHORS: Record<ConversationMessage['role'], string> = {
  owner: 'you',
  assistant: 'guide',
  system: 'system',
}

/**
 * One turn of the task conversation, rendered as a transcript line rather than
 * a ledger row: who spoke, what they said, and — while a response is still
 * owed — that it is owed.
 */
export function ConversationMessageItem({ message }: { message: ConversationMessage }) {
  const isPending = message.status === 'queued' || message.status === 'responding'

  return (
    <li className="py-2" data-timeline-kind="conversation-message">
      <div className="flex items-baseline gap-2">
        <MicroLabel as="span">{AUTHORS[message.role]}</MicroLabel>
        <span className="font-mono text-[0.6rem] text-muted-foreground">
          at {message.taskState.replaceAll('_', ' ')}
        </span>
        <time
          className="ml-auto shrink-0 font-mono text-[0.62rem] text-muted-foreground"
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
        <p
          className={cn('mt-2 flex items-center gap-2 font-mono text-xs', signalText('asking'))}
          role="status"
        >
          <Dot className={signalDot('asking')} live halo />
          {message.status === 'responding' ? 'Responding…' : 'Waiting for a response slot…'}
        </p>
      )}

      {message.status === 'failed' && (
        <p className={cn('mt-2 text-sm', signalText('stopped'))}>
          Response failed: {message.failureReason ?? 'no reason was recorded'}
        </p>
      )}
    </li>
  )
}
