import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMessage, TaskDetail } from '../lib/api-client.ts'
import { buildTelemetryAttempts, TelemetryChart } from './telemetry-chart.tsx'

type Stage = TaskDetail['stages'][number]

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'stage-1',
    taskId: 'task-1',
    graphId: 'graph-1',
    graphVersion: 1,
    nodeKey: 'research',
    role: 'researcher',
    provider: 'claude-code',
    status: 'succeeded',
    attempt: 0,
    skillSha: null,
    result: null,
    acceptedCommit: null,
    startedAt: null,
    finishedAt: null,
    interruptionCleanupStatus: null,
    interruptionFailure: null,
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:02:00.000Z',
    telemetry: null,
    ...overrides,
  }
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    sequence: 2,
    replyToMessageId: 'message-0',
    role: 'assistant',
    contentMd: 'Because.',
    status: 'completed',
    stageId: null,
    taskState: 'human_spec_gate',
    contextCommit: 'abc123',
    provider: 'claude-code',
    failureReason: null,
    telemetry: [],
    createdAt: '2026-08-16T10:01:00.000Z',
    updatedAt: '2026-08-16T10:01:01.000Z',
    ...overrides,
  }
}

describe('task telemetry chart', () => {
  test('interleaves conversation response attempts with stage attempts by recorded time', () => {
    const attempts = buildTelemetryAttempts(
      [
        stage({
          telemetry: {
            model: 'stage-model',
            startedAt: '2026-08-16T10:02:00.000Z',
            finishedAt: '2026-08-16T10:03:00.000Z',
            tokens: { input_tokens: 100 },
            costUsd: 1,
          },
        }),
      ],
      [
        message({
          telemetry: [
            {
              provider: 'claude-code',
              model: 'answer-model',
              startedAt: '2026-08-16T10:01:00.000Z',
              finishedAt: '2026-08-16T10:01:00.250Z',
              durationMs: 250,
              tokens: { output_tokens: 12 },
              costUsd: 0,
              raw: null,
            },
          ],
        }),
      ],
    )

    expect(attempts.map((attempt) => attempt.kind)).toEqual(['conversation', 'stage'])
    expect(attempts[0]).toMatchObject({
      label: 'Conversation / attempt 1',
      model: 'answer-model',
      durationMs: 250,
      costUsd: 0,
    })
    // Stage attempts are stored 0-based, and count from one wherever a human reads them.
    expect(attempts[1]).toMatchObject({ label: 'research / attempt 1', model: 'stage-model' })
  })

  test('keeps zero cost distinct from absent cost in the rendered budget trace', () => {
    const rendered = renderToStaticMarkup(
      <TelemetryChart
        stages={[stage()]}
        messages={[
          message({
            telemetry: [
              {
                provider: 'claude-code',
                model: null,
                startedAt: null,
                finishedAt: null,
                durationMs: 0,
                tokens: {},
                costUsd: 0,
                raw: null,
              },
              {
                provider: 'claude-code',
                model: null,
                startedAt: null,
                finishedAt: null,
                durationMs: null,
                tokens: null,
                costUsd: null,
                raw: null,
              },
            ],
          }),
        ]}
      />,
    )

    expect(rendered).toContain('Budget trace by attempt')
    expect(rendered).toContain('Conversation / attempt 1')
    expect(rendered).toContain('Conversation / attempt 2')
    expect(rendered).toContain('$0.0000')
    expect(rendered).toContain('cost absent')
    expect(rendered).toContain('0 tokens')
    expect(rendered).toContain('tokens absent')
    expect(rendered).toContain('research#0')
  })

  test('excludes an interrupted stage with no telemetry from the recorded list', () => {
    const attempts = buildTelemetryAttempts(
      [
        stage({
          status: 'interrupted',
          startedAt: '2026-08-16T10:00:00.000Z',
          finishedAt: '2026-08-16T10:00:05.000Z',
          telemetry: null,
        }),
      ],
      [],
    )

    expect(attempts).toEqual([])
  })

  test('never lists the same stage as both recorded and absent', () => {
    const runningStage = stage({
      status: 'running',
      attempt: 3,
      startedAt: '2026-08-16T10:00:00.000Z',
      telemetry: null,
    })
    const attempts = buildTelemetryAttempts([runningStage], [])
    const rendered = renderToStaticMarkup(<TelemetryChart stages={[runningStage]} messages={[]} />)

    expect(attempts).toEqual([])
    expect(rendered).toContain('No telemetry')
    expect(rendered).toContain('research#3')
  })
})
