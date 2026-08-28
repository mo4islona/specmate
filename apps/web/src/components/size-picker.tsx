import { PLAN_SIZES, type PlanSize } from '@specmate/core'
import { useState } from 'react'
import { Chip, cn, Icon, MenuItem, Popover } from '../ui/index.ts'

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
          <span className="text-muted-foreground">Size</span>
          <span>{value}</span>
          <Icon
            name="chevron-down"
            size="xs"
            className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </Chip>
      }
    >
      {CHOICES.map((choice) => {
        const chosen = choice === value

        return (
          <MenuItem
            key={choice}
            shape="stack"
            role="menuitemradio"
            aria-checked={chosen}
            trailing={
              <Icon name="check" className={cn('mt-0.5 text-foreground', !chosen && 'invisible')} />
            }
            onClick={() => {
              onChange(choice)
              setOpen(false)
            }}
          >
            <span className={cn('block font-mono text-[0.78rem]', chosen && 'font-medium')}>
              {choice}
            </span>
            <span className="mt-0.5 block text-[0.75rem] leading-5 text-muted-foreground">
              {NOTE[choice]}
            </span>
          </MenuItem>
        )
      })}
    </Popover>
  )
}
