import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMessage } from '../lib/api-client.ts'
import { ConversationMessageItem } from './task-screen.tsx'

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    sequence: 2,
    replyToMessageId: 'message-0',
    role: 'assistant',
    contentMd: '',
    status: 'queued',
    stageId: null,
    taskState: 'spec_review',
    contextCommit: null,
    provider: null,
    failureReason: null,
    telemetry: [],
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  }
}

describe('conversation message item', () => {
  test('renders a distinct pending response with its task stage', () => {
    const rendered = renderToStaticMarkup(<ConversationMessageItem message={message()} />)

    expect(rendered).toContain('data-timeline-kind="conversation-message"')
    expect(rendered).toContain('attention-pulse')
    expect(rendered).toContain('spec review')
    expect(rendered).toContain('Waiting for a response slot')
  })

  test('renders the answer as markdown while leaving raw HTML inert', () => {
    const rendered = renderToStaticMarkup(
      <ConversationMessageItem
        message={message({
          status: 'completed',
          contentMd: '**Bounded.** <script>alert(1)</script>',
        })}
      />,
    )

    expect(rendered).toContain('<strong>Bounded.</strong>')
    expect(rendered).not.toContain('<script>')
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('renders the recorded failure in the answer position', () => {
    const rendered = renderToStaticMarkup(
      <ConversationMessageItem
        message={message({ status: 'failed', failureReason: 'provider unavailable' })}
      />,
    )

    expect(rendered).toContain('Response failed: provider unavailable')
  })
})
