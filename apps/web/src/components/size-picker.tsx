import { PLAN_SIZES, type PlanSize } from '@specmate/core'
import { useState } from 'react'
import { Chip, cx, Icon, Popover } from '../ui/index.ts'

/**
 * The size the owner declares up front, or `auto` — the absence of one, which
 * leaves the shape of the run to planning once it has read the code.
 */
export type SizeChoice = 'auto' | PlanSize

const CHOICES: readonly SizeChoice[] = ['auto', ...PLAN_SIZES]

/** What the choice actually buys. `small` and `large` name nothing on their own. */
const NOTE: Record<SizeChoice, string> = {
  auto: 'Planning decides once it has read the code',
  small: 'One iteration. No spec review, tighter caps',
  medium: 'The full walk — specify, review, implement, validate',
  large: 'The full walk, at the widest caps',
}

interface SizePickerProps {
  readonly value: SizeChoice
  readonly onChange: (value: SizeChoice) => void
}

/**
 * A trigger carrying the current value, and a menu that says what each option
 * means at the moment of choosing. The strip of four bare words this replaces
 * asked the owner to already know what `large` bought — which is the one thing
 * a person launching their first task does not.
 */
export function SizePicker({ value, onChange }: SizePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onDismiss={() => setOpen(false)}
      side="bottom"
      padding="menu"
      role="menu"
      label="Plan size"
      trigger={
        <Chip
          className="min-h-9 gap-2"
          expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen(!open)}
        >
          <span className="text-muted">Size</span>
          <span>{value}</span>
          <Icon
            name="chevron-down"
            size="xs"
            className={cx('text-muted transition-transform', open && 'rotate-180')}
          />
        </Chip>
      }
    >
      {CHOICES.map((choice) => {
        const chosen = choice === value

        return (
          <button
            key={choice}
            type="button"
            role="menuitemradio"
            aria-checked={chosen}
            className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-text/[0.06]"
            onClick={() => {
              onChange(choice)
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  'block font-mono text-[0.78rem]',
                  chosen ? 'font-medium text-text' : 'text-text',
                )}
              >
                {choice}
              </span>
              <span className="mt-0.5 block text-[0.75rem] leading-5 text-muted">
                {NOTE[choice]}
              </span>
            </span>

            <Icon name="check" className={cx('mt-0.5 text-text', !chosen && 'invisible')} />
          </button>
        )
      })}
    </Popover>
  )
}
