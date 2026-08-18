#!/usr/bin/env bun
/**
 * Stands in for the provider CLI so the suite needs no network, no credential
 * and no container runtime. Its behaviour is chosen by SPECMATE_STUB_MODE, and
 * it records what it was given so tests can assert on the invocation.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Answered before anything else, as the real CLI does — and before the mode
// queue is consumed, so a health check does not eat an attempt's outcome.
if (process.argv.includes('--version')) {
  await Bun.write(Bun.stdout, '1.0.0-stub (Claude Code)\n')
  process.exit(0)
}

const cwd = process.cwd()
const prompt = await Bun.stdin.text()
const mode = await nextMode()

/**
 * A queue file lets one test drive several attempts with different outcomes,
 * which is the only way to exercise the retry path through the real invocation.
 */
async function nextMode(): Promise<string> {
  const queue = process.env.SPECMATE_STUB_MODE_FILE
  if (!queue) return process.env.SPECMATE_STUB_MODE ?? 'ok'

  const modes = JSON.parse(await readFile(queue, 'utf8')) as string[]
  const [head, ...rest] = modes
  await writeFile(queue, JSON.stringify(rest))

  return head ?? 'ok'
}

const record = process.env.SPECMATE_STUB_RECORD
if (record) {
  await mkdir(dirname(record), { recursive: true })
  const env = { ...process.env }
  await writeFile(
    record,
    JSON.stringify({ argv: process.argv.slice(2), prompt, cwd, env }, null, 2),
  )
}

const telemetry = JSON.stringify({
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0.42,
  usage: { input_tokens: 1200, output_tokens: 340 },
  modelUsage: { 'stub-model-1': { inputTokens: 1200, outputTokens: 340 } },
})

async function writeResult(body: string): Promise<void> {
  await writeFile(join(cwd, 'RESULT.json'), body)
}

async function writeConversation(
  message: string,
  providerSession?: Record<string, unknown>,
  actions: readonly unknown[] = [],
): Promise<void> {
  const match = prompt.match(
    /Write the structured conversation result to `([^`]+\/CONVERSATION\.json)`\./,
  )
  if (!match?.[1]) throw new Error('conversation prompt did not name its scratch path')

  const path = join(cwd, match[1])
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      message_md: message,
      actions,
      ...(providerSession ? { provider_session: providerSession } : {}),
    }),
  )
}

async function commitStrayChange(): Promise<void> {
  for (const args of [
    ['add', '-A'],
    ['commit', '--quiet', '-m', 'conversation response must stay detached'],
  ]) {
    const process = Bun.spawn({
      cmd: [
        'git',
        '-c',
        'user.name=Answer Stub',
        '-c',
        'user.email=answer-stub@localhost',
        ...args,
      ],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(`stub git ${args[0]} failed: ${stderr.trim()}`)
  }
}

function role(): string {
  return process.env.SPECMATE_STUB_ROLE ?? 'researcher'
}

/**
 * The stub's stand-in for a probe's assessment — every mode using `role()` as
 * planner needs one to parse. `SPECMATE_STUB_HARNESS_CLASSIFICATION` lets a
 * test drive the coverage rule without touching the brief content itself.
 */
const STUB_HARNESS_COVERAGE = {
  classification: (process.env.SPECMATE_STUB_HARNESS_CLASSIFICATION ?? 'adequate') as
    | 'adequate'
    | 'partial'
    | 'missing',
  evidence_md: 'stub: an existing e2e suite covers this path.',
}

function validResult(): string {
  const current = role()

  return JSON.stringify({
    schema_version: 1,
    role: current,
    status: 'ok',
    notes_md: 'stub run',
    ...(current === 'planner' ? { harness_coverage: STUB_HARNESS_COVERAGE } : {}),
  })
}

/** A single fence: six backticks, matching `prompt.ts`'s `fence()` helper. */
const FENCE = '`'.repeat(6)

/** Copies the `answer_decision` skeleton the prompt offered, as a real assistant would. */
function proposedAnswerDecisionAction(
  prompt: string,
  instruction: string,
): Record<string, unknown> {
  const pattern = new RegExp(
    `## answer_decision\\n\\n[\\s\\S]*?${FENCE}json\\n([\\s\\S]*?)\\n${FENCE}`,
  )
  const match = prompt.match(pattern)
  if (!match?.[1]) throw new Error('no answer_decision action skeleton found in the prompt')

  return { ...JSON.parse(match[1]), instruction }
}

/** Review verdicts, so one queue file can drive a loop: revise, then approve. */
async function writeVerdict(verdict: string): Promise<void> {
  const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'review.md'), `# stub review: ${verdict}\n`)
  const findings =
    verdict === 'approve'
      ? []
      : [
          {
            id: process.env.SPECMATE_STUB_FINDING ?? 'stub-finding',
            severity: 'major',
            title: 'Stub finding',
            detail_md: '',
          },
        ]
  await writeResult(
    JSON.stringify({
      schema_version: 1,
      role: role(),
      status: 'ok',
      verdict,
      findings,
      notes_md: 'stub review',
    }),
  )
  await Bun.write(Bun.stdout, `${telemetry}\n`)
}

/** Verifier verdicts: the matrix under `verification.md` comes from the test. */
async function writeVerification(verdict: string): Promise<void> {
  const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
  await mkdir(folder, { recursive: true })
  const matrix = process.env.SPECMATE_STUB_MATRIX ?? ''
  await writeFile(join(folder, 'verification.md'), `# Verification\n\n## Matrix\n\n${matrix}\n`)
  await writeResult(
    JSON.stringify({
      schema_version: 1,
      role: 'verifier',
      status: 'ok',
      verdict,
      findings: [],
      notes_md: 'stub verification',
    }),
  )
  await Bun.write(Bun.stdout, `${telemetry}\n`)
}

/** A brief carrying every part `checkBrief` requires — used by both the grounding and presenting stub modes. */
const BRIEF_MD = [
  '## What and Why',
  '',
  'Fix the redirect so it lands on the dashboard.',
  '',
  '## Approach',
  '',
  '- Read the redirect config',
  '- Correct the target route',
  '',
  '## Key Points',
  '',
  '- Risk: low',
  '- Blast radius: login flow only',
  '',
  '## Open Questions',
  '',
  'No open questions.',
  '',
  '## Size',
  '',
  'Small; expected to take one iteration.',
  '',
].join('\n')

/** Same as `BRIEF_MD`, but carrying the mandatory warning a short-of-adequate classification requires. */
const BRIEF_MD_WITH_HARNESS_GAP = BRIEF_MD.replace(
  '- Blast radius: login flow only',
  '- Blast radius: login flow only\n- Harness gap: no state-level suite exercises the redirect end to end.',
)

const MISSING_HARNESS_COVERAGE = {
  classification: 'missing' as const,
  evidence_md: 'No state-level suite exercises the redirect end to end.',
}

/** A stream-json transcript: init, two tool uses interleaved with results, then the result line. */
const ACTIVITY_TRANSCRIPT = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'stub-session' }),
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Looking at the file.' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: 'a.ts' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2' }] },
  }),
  telemetry,
].join('\n')

switch (mode) {
  case 'activity': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# written by the stub\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${ACTIVITY_TRANSCRIPT}\n`)
    break
  }
  case 'activity-garbled': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# written by the stub\n')
    await writeResult(validResult())
    // A CLI without structured streaming support still has to leave the stage
    // standing (REQ-212/AC-228) — mixed garbage and half-written JSON among
    // otherwise valid lines must never throw or drop the run.
    const noisy = [
      'not json at all',
      '{ this is not valid json',
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'not-an-array' },
      }),
      ACTIVITY_TRANSCRIPT,
    ].join('\n')
    await Bun.write(Bun.stdout, `${noisy}\n`)
    break
  }
  case 'conversation': {
    await writeConversation('The artifacts choose the safer option.\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-session': {
    await writeConversation('The artifacts choose the safer option.\n', {
      id: 'opaque-session-reference',
    })
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-action': {
    await writeConversation('I can pass that guidance to implementation.\n', undefined, [
      {
        kind: 'instruct_next_run',
        target: {
          taskId: '55555555-5555-4555-8555-555555555555',
          graphId: '77777777-7777-4777-8777-777777777777',
          nodeKey: 'implement',
        },
        instruction: 'Keep the compatibility adapter.',
        expectedVersion: {
          taskStatus: 'research',
          graphId: '77777777-7777-4777-8777-777777777777',
        },
      },
    ])
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-invented-action': {
    await writeConversation('I can restart that stage.\n', undefined, [
      {
        kind: 'restart_stage',
        target: { taskId: 'invented-task', stageId: 'invented-stage' },
        expectedVersion: { taskStatus: 'paused' },
      },
    ])
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-answer-decision': {
    await writeConversation('I recommend "the whole repository".', undefined, [
      proposedAnswerDecisionAction(prompt, 'The whole repository.'),
    ])
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'empty-conversation': {
    await writeConversation('   \n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-stray': {
    await writeFile(join(cwd, 'src/app.ts'), 'export const a = 99\n')
    await writeConversation('The change would be unsafe.\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'conversation-commit': {
    await writeFile(join(cwd, 'src/app.ts'), 'export const a = 99\n')
    await writeConversation('The change would be unsafe.\n')
    await writeResult(validResult())
    await commitStrayChange()
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'approve':
  case 'revise':
  case 'escalate': {
    await writeVerdict(mode)
    break
  }
  case 'verify': {
    await writeVerification(process.env.SPECMATE_STUB_VERDICT ?? 'approve')
    break
  }
  case 'verify-no-report': {
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: 'verifier',
        status: 'ok',
        verdict: process.env.SPECMATE_STUB_VERDICT ?? 'approve',
        findings: [],
        notes_md: 'stub verification without a report',
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'ok': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# written by the stub\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'brief-complete': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), BRIEF_MD)
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: 'planner',
        status: 'ok',
        notes_md: 'stub run',
        harness_coverage: STUB_HARNESS_COVERAGE,
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'brief-complete-questions': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), BRIEF_MD)
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: 'planner',
        status: 'ok',
        artifacts_changed: [
          {
            path: `openspec/changes/${process.env.SPECMATE_STUB_SLUG}/proposal.md`,
            kind: 'proposal',
            op: 'modified',
          },
        ],
        decisions_needed: [
          {
            key: 'auth-scope',
            kind: 'question',
            prompt_md: 'Should this cover mobile clients too?',
            options: [],
            blocking: false,
          },
          {
            key: 'data-retention',
            kind: 'question',
            prompt_md: 'Revoke old sessions immediately, or let them expire?',
            options: [],
            blocking: false,
          },
        ],
        notes_md: 'stub brief with open questions',
        harness_coverage: STUB_HARNESS_COVERAGE,
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'brief-complete-harness-gap': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), BRIEF_MD_WITH_HARNESS_GAP)
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: 'planner',
        status: 'ok',
        artifacts_changed: [
          {
            path: `openspec/changes/${process.env.SPECMATE_STUB_SLUG}/proposal.md`,
            kind: 'proposal',
            op: 'modified',
          },
        ],
        notes_md: 'stub brief carrying a harness gap warning',
        harness_coverage: MISSING_HARNESS_COVERAGE,
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'scribble-decision-log': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# written by the stub\n')
    await writeFile(join(folder, 'decisions.md'), '# an agent scribbled here\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'needs-decision': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(
      join(folder, 'proposal.md'),
      '# a question came up before this could be drafted\n',
    )
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: role(),
        status: 'needs_decision',
        decisions_needed: [
          {
            key: 'scope',
            kind: 'question',
            prompt_md: 'What does this cover?',
            options: [],
            blocking: true,
          },
        ],
        notes_md: 'a blocking question came up',
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'no-result': {
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'half-written': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# HALF-WRITTEN-GARBAGE\n')
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'agent-failed': {
    const folder = join(cwd, 'openspec/changes', process.env.SPECMATE_STUB_SLUG ?? 'unknown')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'proposal.md'), '# BROKEN-OUTPUT\n')
    await writeResult(
      JSON.stringify({
        schema_version: 1,
        role: role(),
        status: 'failed',
        notes_md: 'the stub could not finish',
      }),
    )
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'invalid-result': {
    await writeResult('{ this is not json')
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'garbled-telemetry': {
    await writeResult(validResult())
    await Bun.write(Bun.stdout, 'not json at all\n')
    break
  }
  case 'out-of-scope': {
    await writeFile(join(cwd, 'src/app.ts'), 'export const a = 2\n')
    await writeResult(validResult())
    await Bun.write(Bun.stdout, `${telemetry}\n`)
    break
  }
  case 'nonzero-exit': {
    await Bun.write(Bun.stderr, 'stub failed on purpose\n')
    process.exit(3)
    break
  }
  case 'expired': {
    await Bun.write(Bun.stderr, 'Invalid credentials · Please run /login\n')
    process.exit(1)
    break
  }
  case 'hang': {
    // Outlives any deadline a test sets; the runner must kill it. The timer is
    // what keeps the process alive — a pending promise alone is not a handle.
    setInterval(() => {}, 1_000)
    await new Promise(() => {})
    break
  }
  default:
    await Bun.write(Bun.stderr, `unknown stub mode: ${mode}\n`)
    process.exit(2)
}
