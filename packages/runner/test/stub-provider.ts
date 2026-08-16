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

function role(): string {
  return process.env.SPECMATE_STUB_ROLE ?? 'researcher'
}

function validResult(): string {
  return JSON.stringify({
    schema_version: 1,
    role: role(),
    status: 'ok',
    notes_md: 'stub run',
  })
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

switch (mode) {
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
