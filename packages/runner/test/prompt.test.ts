import { afterAll, describe, expect, test } from 'bun:test'
import { assemblePrompt, RolePromptMissingError } from '../src/prompt.ts'
import { cleanupTempDirs, makeConfig, makeHarness, tempDir, writeFiles } from './fixtures.ts'

afterAll(cleanupTempDirs)

const LEDGER = '## Task\n\n- Title: a task\n'

async function setup(slug: string) {
  const harness = await makeHarness(slug)
  const params = {
    workspace: harness.workspace,
    baseBranch: 'main',
    ledger: LEDGER,
  }

  return { harness, params }
}

describe('prompt assembly', () => {
  test('withholds artifact kinds the role does not read', async () => {
    const { harness, params } = await setup('withholds')
    await writeFiles(harness.workspace.path, {
      'openspec/changes/withholds/proposal.md': '# the proposal\n',
      'openspec/changes/withholds/review.md': '# the review\n',
    })

    // The researcher reads proposal and decision_log, never review.
    const prompt = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'researcher',
    })

    expect(prompt).toContain('# the proposal')
    expect(prompt).not.toContain('# the review')
  })

  test('gives a reviewing role the product-code diff', async () => {
    const { harness, params } = await setup('reviewable')
    await writeFiles(harness.workspace.path, { 'src/app.ts': 'export const a = 99\n' })
    await harness.commitAll('implementer output')

    const prompt = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'reviewer',
    })

    expect(prompt).toContain('export const a = 99')
    expect(prompt).toContain('# Product code changed on this branch')
  })

  test('keeps the change folder out of the diff', async () => {
    const { harness, params } = await setup('no-overlap')
    await writeFiles(harness.workspace.path, {
      'openspec/changes/no-overlap/review.md': 'REVIEW-BODY-MARKER\n',
    })
    await harness.commitAll('review output')

    // The researcher does not read review.md; it must not arrive via the diff.
    const prompt = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'researcher',
    })

    expect(prompt).not.toContain('REVIEW-BODY-MARKER')
  })

  test('fails by name when the role has no prompt file', async () => {
    const { harness, params } = await setup('no-prompt')
    const empty = await tempDir('roles')

    const assemble = assemblePrompt(harness.git, makeConfig({ rolesDir: empty }), {
      ...params,
      role: 'planner',
    })

    await expect(assemble).rejects.toThrow(RolePromptMissingError)
    await expect(assemble).rejects.toThrow(/planner/)
  })

  test('assembles for the first stage of a fresh task', async () => {
    const { harness, params } = await setup('fresh')

    const prompt = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'researcher',
    })

    expect(prompt).toContain('# Role: Researcher')
    expect(prompt).toContain('The change folder holds none of the artifacts your role reads yet.')
    expect(prompt).toContain('No product code has changed on this branch yet.')
  })

  test('is byte-identical for the same state', async () => {
    const { harness, params } = await setup('deterministic')
    await writeFiles(harness.workspace.path, {
      'openspec/changes/deterministic/proposal.md': '# stable\n',
    })

    const config = makeConfig()
    const once = await assemblePrompt(harness.git, config, { ...params, role: 'researcher' })
    const twice = await assemblePrompt(harness.git, config, { ...params, role: 'researcher' })

    expect(twice).toBe(once)
  })

  test('injects stored conversation context, the current message, and its scratch path', async () => {
    const { harness, params } = await setup('conversation')
    const first = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'answerer',
      conversation: {
        context: '## assistant #2\n\nOption A was safer.',
        message: 'Why was option A chosen?',
        resultPath: '.specmate/message-1-0/CONVERSATION.json',
        previousAnchorCommit: null,
        previousTaskState: null,
        currentAnchorCommit: 'current',
        currentTaskState: 'research',
        contextPath: 'stored',
        actionOptions: [
          {
            kind: 'restart_stage',
            target: {
              taskId: 'task-1',
              graphId: 'graph-1',
              nodeKey: 'research',
              stageId: 'stage-1',
            },
            expectedVersion: {
              taskStatus: 'paused',
              graphId: 'graph-1',
              stageId: 'stage-1',
              attempt: 2,
            },
            instruction: 'optional',
            description: 'Restart interrupted stage research, attempt 2.',
          },
        ],
      },
    })
    const second = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'answerer',
      conversation: {
        context: '## assistant #2\n\nOption A was safer.',
        message: 'What happens under option B?',
        resultPath: '.specmate/message-2-0/CONVERSATION.json',
        previousAnchorCommit: null,
        previousTaskState: null,
        currentAnchorCommit: 'current',
        currentTaskState: 'research',
        contextPath: 'stored',
        actionOptions: [],
      },
    })

    expect(first).toContain('Why was option A chosen?')
    expect(first).toContain('Option A was safer.')
    expect(first).toContain('.specmate/message-1-0/CONVERSATION.json')
    expect(first).toContain('"taskId": "task-1"')
    expect(first).toContain('"stageId": "stage-1"')
    expect(first).toContain('Instruction: optional.')
    expect(second).toContain('What happens under option B?')
    expect(second).not.toContain('Why was option A chosen?')
    expect(second).toContain('Return an empty `actions` array.')
  })

  test('announces a diff it had to truncate', async () => {
    const { harness, params } = await setup('capped')
    await writeFiles(harness.workspace.path, { 'src/big.ts': `${'// padding\n'.repeat(2000)}` })
    await harness.commitAll('a large change')

    const prompt = await assemblePrompt(harness.git, makeConfig({ diffBytesLimit: 512 }), {
      ...params,
      role: 'reviewer',
    })

    expect(prompt).toContain('[truncated: product-code diff exceeded 512 bytes')
  })
})
