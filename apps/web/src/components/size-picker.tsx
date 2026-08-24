import { PLAN_SIZES, type PlanSize } from '@specmate/core'
import { useEffect, useRef, useState } from 'react'

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
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="chip min-h-9 gap-2"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <span className="text-muted">Size</span>
        <span>{value}</span>
        <span
          className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="console-popover absolute left-0 top-full z-20 mt-2 w-[21rem] p-1.5"
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
                    className={`block font-mono text-[0.78rem] ${chosen ? 'text-accent' : 'text-text'}`}
                  >
                    {choice}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] leading-5 text-muted">
                    {NOTE[choice]}
                  </span>
                </span>

                <span
                  className={`shrink-0 pt-0.5 text-accent ${chosen ? '' : 'invisible'}`}
                  aria-hidden="true"
                >
                  ✓
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
