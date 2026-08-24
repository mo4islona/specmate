import { describe, expect, it } from 'vitest'
import { changeNameFor, PlanShape, parseStageResult } from '../src/index.ts'

function plan(overrides: Partial<PlanShape> = {}): PlanShape {
  return PlanShape.parse({
    title: 'Keep the Y-axis edge fade and gutter off pie charts',
    type: 'feature',
    size: 'medium',
    ...overrides,
  })
}

describe("the change's name (REQ-1306)", () => {
  it('is what planning declared, when it declared one — AC-1323', () => {
    expect(changeNameFor(plan({ change: 'pie-chart-axis-fade' }))).toBe('pie-chart-axis-fade')
  })

  it('is cut from the declared title when there is none — AC-1324', () => {
    expect(changeNameFor(plan())).toBe('keep-the-y-axis-edge-fade-and-gutter-off-pie-charts')
  })

  it('leaves no trailing dash where the title had to be cut short', () => {
    const long = changeNameFor(plan({ title: 'a'.repeat(60).concat(' and then some more words') }))

    expect(long?.endsWith('-')).toBe(false)
  })

  it('answers nothing for a title that cuts down to nothing nameable', () => {
    expect(changeNameFor(plan({ title: '???' }))).toBeNull()
  })

  it('rejects a declared name outside the shape a change folder takes — AC-1325', () => {
    const parsed = parseStageResult(
      JSON.stringify({
        schema_version: 1,
        role: 'planner',
        status: 'ok',
        notes_md: 'stub',
        harness_coverage: { classification: 'adequate', evidence_md: 'there is one' },
        plan: { title: 'A change', change: 'Pie Charts!', type: 'feature', size: 'small' },
      }),
    )

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('plan.change')
  })

  it('accepts a plan that declares no name at all — AC-1324', () => {
    expect(plan().change).toBeUndefined()
  })
})
