import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type AgentRole, ROLE_CONTRACTS } from '@specmate/core'
import { ROLES_DIR } from './fixtures.ts'

/** Planner and retro belong to the kickoff-brief and Retro changes. */
const PHASE_ONE: AgentRole[] = [
  'researcher',
  'spec_writer',
  'implementer',
  'verifier',
  'reviewer',
  'summarizer',
]

describe('role prompts', () => {
  test('answerer names its scratch product and the no-changes rule', async () => {
    const body = await readFile(join(ROLES_DIR, 'answerer.md'), 'utf8')

    expect(body).toContain('strictly read-only')
    expect(body).toContain('Never modify artifacts, product code, task state, gates')
    expect(body).toContain('separately confirms')
    expect(body).toContain('CONVERSATION.json')
    expect(body).toContain('Never invent or alter an identifier')
    expect(body).toContain('expectedVersion')
    expect(body).toContain('# Role: Answerer')
    expect(body).toContain('## What you are given')
    expect(body).toContain('## What you may write')
    expect(body).toContain('## How to work')
    expect(body).toContain('## How to finish')
  })

  test.each(PHASE_ONE)('%s has the prompt file its contract names', async (role) => {
    const contract = ROLE_CONTRACTS[role]
    const file = contract.promptFile.slice(contract.promptFile.lastIndexOf('/') + 1)
    const body = await readFile(join(ROLES_DIR, file), 'utf8')

    expect(body).toContain('RESULT.json')
    expect(body).toContain('## What you may write')
  })

  test('roles that may not write code say so in their prompt', async () => {
    for (const role of PHASE_ONE) {
      const contract = ROLE_CONTRACTS[role]
      if (contract.writesCode) continue

      const file = contract.promptFile.slice(contract.promptFile.lastIndexOf('/') + 1)
      const body = await readFile(join(ROLES_DIR, file), 'utf8')
      expect(body).toContain('You may not modify product code')
    }
  })
})
