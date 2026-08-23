import { afterAll, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BRIEF_SECTIONS, parseStageResult } from '@specmate/core'
import { assemblePrompt, RolePromptMissingError } from '../src/prompt.ts'
import {
  cleanupTempDirs,
  makeConfig,
  makeHarness,
  ROLES_DIR,
  tempDir,
  writeFiles,
} from './fixtures.ts'

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

  test('carries a waived task’s ledger line and the summarizer’s instruction to state it', async () => {
    const { harness, params } = await setup('summarizer-waived')

    const prompt = await assemblePrompt(harness.git, makeConfig(), {
      ...params,
      role: 'summarizer',
      ledger:
        '## Task\n\n- Title: a task\n- Harness coverage: waived — no e2e suite for this path.\n',
    })

    expect(prompt).toContain('Harness coverage: waived — no e2e suite for this path.')
    expect(prompt).toContain('verified without a state-level harness')
  })

  test('gives the planner the draft proposal it is refining and the decision log that rejected the last one', async () => {
    const { harness, params } = await setup('planner-reads')
    const rolesDir = await tempDir('roles')
    await writeFiles(rolesDir, { 'planner.md': '# Role: Planner\n' })
    await writeFiles(harness.workspace.path, {
      'openspec/changes/planner-reads/proposal.md': '# draft brief\n\nA rough grounding.\n',
      'openspec/changes/planner-reads/decisions.md': '# decision log\n\nRedirected: too vague.\n',
    })

    const prompt = await assemblePrompt(harness.git, makeConfig({ rolesDir }), {
      ...params,
      role: 'planner',
    })

    expect(prompt).toContain('# draft brief')
    expect(prompt).toContain('# decision log')
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

  test('resolves the real prompt file for the planner role', async () => {
    const { harness, params } = await setup('planner-real-prompt')

    const prompt = await assemblePrompt(harness.git, makeConfig(), { ...params, role: 'planner' })

    expect(prompt).toContain('# Role: Planner')
  })

  test('the planner prompt names every heading the brief check requires', async () => {
    const body = await readFile(join(ROLES_DIR, 'planner.md'), 'utf8')

    for (const heading of BRIEF_SECTIONS) {
      expect(body).toContain(`## ${heading}`)
    }
  })

  test('every example RESULT.json in the planner prompt parses as a valid StageResult', async () => {
    const body = await readFile(join(ROLES_DIR, 'planner.md'), 'utf8')
    const examples = [...body.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? '')

    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      const parsed = parseStageResult(example)
      expect(parsed.ok).toBe(true)
    }
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
        currentTaskState: 'specify',
        contextPath: 'stored',
        actionOptions: [
          {
            kind: 'restart_stage',
            target: {
              taskId: 'task-1',
              graphId: 'graph-1',
              nodeKey: 'specify',
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
        currentTaskState: 'specify',
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
