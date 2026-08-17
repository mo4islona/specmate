import { afterAll, describe, expect, test } from 'bun:test'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConversationWorkspace } from '@specmate/workspace'
import { ClaudeCodeProvider } from '../src/claude.ts'
import {
  ConversationExecutor,
  type ConversationExecutorDeps,
  type ConversationRequest,
} from '../src/conversation-executor.ts'
import { LocalBackend } from '../src/local-backend.ts'
import {
  cleanupTempDirs,
  type Harness,
  makeConfig,
  makeHarness,
  STUB_ENV,
  setStubEnv,
  tempDir,
} from './fixtures.ts'

afterAll(cleanupTempDirs)

function makeExecutor(harness: Harness, mode: string, record?: string): ConversationExecutor {
  const config = makeConfig({ forwardEnv: STUB_ENV })
  setStubEnv({
    SPECMATE_STUB_MODE: mode,
    SPECMATE_STUB_ROLE: 'answerer',
    SPECMATE_STUB_SLUG: harness.workspace.slug,
    ...(record ? { SPECMATE_STUB_RECORD: record } : {}),
  })
  const provider = new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
  const deps: ConversationExecutorDeps = {
    config,
    provider,
    git: harness.git,
    ledger: async () => '## Task\n\n- Current state: research\n',
  }

  return new ConversationExecutor(deps)
}

function request(workspace: ConversationWorkspace): ConversationRequest {
  return {
    taskId: '55555555-5555-4555-8555-555555555555',
    conversationId: 'conversation-1',
    responseId: '66666666-6666-4666-8666-666666666666',
    message: 'Why was this design chosen?',
    context: '## owner #1\n\nWhat did we decide earlier?',
    previousAnchorCommit: null,
    previousTaskState: null,
    currentAnchorCommit: workspace.branch,
    currentTaskState: 'research',
    contextPath: 'stored',
    actionOptions: [
      {
        kind: 'instruct_next_run',
        target: {
          taskId: '55555555-5555-4555-8555-555555555555',
          graphId: '77777777-7777-4777-8777-777777777777',
          nodeKey: 'implement',
        },
        expectedVersion: {
          taskStatus: 'research',
          graphId: '77777777-7777-4777-8777-777777777777',
        },
        instruction: 'required',
        description: 'Attach guidance to the next run of stage implement.',
      },
    ],
    workspace,
    baseBranch: 'main',
    environment: { image: 'local://host', toolchains: [] },
    attempt: 0,
  }
}

describe('conversation execution', () => {
  test('injects prior context and reads a structured message product', async () => {
    const harness = await makeHarness('conversation-product')
    await harness.commitAll('baseline')
    const record = join(await tempDir('conversation-record'), 'record.json')
    const workspace = await harness.manager.provisionConversation(
      harness.workspace,
      'conversation-0',
    )

    const execution = await makeExecutor(harness, 'conversation', record).execute(
      request(workspace),
    )

    expect(execution).toMatchObject({
      status: 'succeeded',
      message: 'The artifacts choose the safer option.',
      actions: [],
    })
    const seen = (await Bun.file(record).json()) as { cwd: string; prompt: string }
    expect(await realpath(seen.cwd)).toBe(await realpath(workspace.path))
    expect(seen.prompt).toContain('What did we decide earlier?')
    expect(seen.prompt).toContain('Why was this design chosen?')
    expect(seen.prompt).toContain('CONVERSATION.json')
    expect(seen.prompt).toContain('55555555-5555-4555-8555-555555555555')
    expect(seen.prompt).toContain('77777777-7777-4777-8777-777777777777')
    expect(seen.prompt).toContain('Instruction: required.')
    await harness.manager.releaseConversation(
      harness.workspace.slug,
      harness.workspace.repoUrl,
      workspace.key,
    )
  })

  test('returns opaque provider metadata without requiring it for reconstruction', async () => {
    const harness = await makeHarness('conversation-reconstruction')
    await harness.commitAll('baseline')
    const workspace = await harness.manager.provisionConversation(
      harness.workspace,
      'reconstruction-0',
    )

    const execution = await makeExecutor(harness, 'conversation-session').execute({
      ...request(workspace),
      contextPath: 'reconstructed',
    })

    expect(execution).toMatchObject({
      status: 'succeeded',
      message: 'The artifacts choose the safer option.',
      providerSession: { id: 'opaque-session-reference' },
    })
    await harness.manager.releaseConversation(
      harness.workspace.slug,
      harness.workspace.repoUrl,
      workspace.key,
    )
  })

  test('accepts only actions copied from the live prompt skeletons', async () => {
    const harness = await makeHarness('conversation-actions')
    await harness.commitAll('baseline')
    const workspace = await harness.manager.provisionConversation(
      harness.workspace,
      'conversation-actions-0',
    )

    const accepted = await makeExecutor(harness, 'conversation-action').execute(request(workspace))
    expect(accepted).toMatchObject({
      status: 'succeeded',
      actions: [
        {
          kind: 'instruct_next_run',
          target: { taskId: '55555555-5555-4555-8555-555555555555' },
          instruction: 'Keep the compatibility adapter.',
        },
      ],
    })

    const rejected = await makeExecutor(harness, 'conversation-invented-action').execute(
      request(workspace),
    )
    expect(rejected).toMatchObject({
      status: 'failed',
      failure: 'malformed_message',
      detail: 'action restart_stage does not match an available action skeleton',
    })
    await harness.manager.releaseConversation(
      harness.workspace.slug,
      harness.workspace.repoUrl,
      workspace.key,
    )
  })

  test.each(['ok', 'empty-conversation'])(
    'rejects a missing or malformed message (%s)',
    async (mode) => {
      const harness = await makeHarness(`conversation-${mode}`)
      await harness.commitAll('baseline')
      const workspace = await harness.manager.provisionConversation(harness.workspace, `${mode}-0`)

      const execution = await makeExecutor(harness, mode).execute(request(workspace))

      expect(execution).toMatchObject({ status: 'failed', failure: 'malformed_message' })
      await harness.manager.releaseConversation(
        harness.workspace.slug,
        harness.workspace.repoUrl,
        workspace.key,
      )
    },
  )

  test('keeps stray writes and commits inside the disposable checkout', async () => {
    const harness = await makeHarness('conversation-stray')
    await harness.commitAll('baseline')
    const workspace = await harness.manager.provisionConversation(
      harness.workspace,
      'conversation-stray-0',
    )

    const execution = await makeExecutor(harness, 'conversation-commit').execute(request(workspace))

    expect(execution.message).toBe('The change would be unsafe.')
    expect(
      (
        await harness.git.run(['status', '--porcelain=v1'], { cwd: harness.workspace.path })
      ).stdout.trim(),
    ).toBe('')
    await harness.manager.releaseConversation(
      harness.workspace.slug,
      harness.workspace.repoUrl,
      workspace.key,
    )
  })
})
