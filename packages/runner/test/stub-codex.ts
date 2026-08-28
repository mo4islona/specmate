#!/usr/bin/env bun
/**
 * Stands in for the Codex CLI. Deliberately small next to `stub-provider.ts`:
 * everything a stage does with a run once it has finished is the same for every
 * provider and is covered there, so this exists to speak this CLI's own
 * vocabulary — its JSONL events, its `fork` subcommand, its `login status`.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const argv = process.argv.slice(2)

if (argv.includes('--version')) {
  await Bun.write(Bun.stdout, 'codex-cli 0.0.0-stub\n')
  process.exit(0)
}

if (argv[0] === 'login' && argv[1] === 'status') {
  const mode = process.env.SPECMATE_CODEX_STUB_LOGIN ?? 'ok'
  if (mode === 'ok') {
    await Bun.write(Bun.stdout, 'Logged in using ChatGPT\n')
    process.exit(0)
  }

  await Bun.write(Bun.stderr, mode === 'expired' ? 'Not logged in\n' : 'something else broke\n')
  process.exit(1)
}

const cwd = process.cwd()
const prompt = await Bun.stdin.text()
const forking = argv[1] === 'fork' ? argv[2] : undefined

const record = process.env.SPECMATE_CODEX_STUB_RECORD
if (record) await writeFile(record, JSON.stringify({ argv, prompt, cwd }, null, 2))

// A fork the CLI will not make, worded as the real one words it — the cold-start
// path is exercised against something it actually has to recognize.
if (forking && process.env.SPECMATE_CODEX_STUB_REFUSE_FORK === forking) {
  await Bun.write(
    Bun.stderr,
    `Error: thread/fork: thread/fork failed: no rollout found for thread id ${forking} (code -32600)\n`,
  )
  process.exit(1)
}

const events = [
  { type: 'thread.started', thread_id: process.env.SPECMATE_CODEX_STUB_SESSION ?? 'stub-thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'On it.' } },
  {
    type: 'item.started',
    item: { id: 'item_1', type: 'command_execution', command: 'ls', status: 'in_progress' },
  },
  {
    type: 'item.completed',
    item: { id: 'item_1', type: 'command_execution', command: 'ls', status: 'completed' },
  },
  {
    type: 'item.completed',
    item: {
      id: 'item_2',
      type: 'file_change',
      changes: [{ path: join(cwd, 'openspec/changes/x/proposal.md'), kind: 'update' }],
      status: 'completed',
    },
  },
  {
    type: 'turn.completed',
    usage: {
      input_tokens: 1200,
      cached_input_tokens: 900,
      cache_write_input_tokens: 0,
      output_tokens: 340,
      reasoning_output_tokens: 42,
    },
  },
]

await writeFile(
  join(cwd, 'RESULT.json'),
  JSON.stringify({
    schema_version: 1,
    role: process.env.SPECMATE_CODEX_STUB_ROLE ?? 'researcher',
    status: 'ok',
    notes_md: 'stub run',
  }),
)

await Bun.write(Bun.stdout, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
