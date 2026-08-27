import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

interface HoverHintProps {
  readonly hint: ReactNode
  /** How long the pointer must rest before the hint appears. */
  readonly delayMs?: number
  readonly children: ReactNode
}

/**
 * A hint that waits to be asked for. The browser's own `title` needs about a
 * second and then draws an operating-system box in the wrong font; this reads as
 * part of the interface and appears on the same beat.
 *
 * It waits deliberately: a rail of ten rows whose hints fire instantly is a
 * screen that flickers whenever the pointer crosses it on the way somewhere
 * else. Focus shows it at once, because arriving by keyboard is already
 * deliberate — Radix does both without being told.
 *
 * It is drawn into the document body rather than beside what it describes. The
 * rail it lives in is a scrolling column with a border, and every one of those
 * clips an absolutely-positioned child; the hint was being cut off on every side
 * at once. That is what a portal is for, and what replaced a hundred lines of
 * measuring the trigger and clamping the result against the viewport by hand.
 *
 * One behaviour did change with the engine: where there is no room beside the
 * row, this now flips to the other side of it rather than dropping underneath.
 * That is what every tooltip does, and it is the reason not to keep a bespoke
 * one.
 *
 * The provider is per hint rather than at the root, which is the price of
 * staying a drop-in part: hints do not share a "one has been open recently, show
 * the next at once" window. Neither did the hand-rolled one.
 */
export function HoverHint({ hint, delayMs = 550, children }: HoverHintProps) {
  if (!hint) return children

  return (
    <TooltipPrimitive.Provider delayDuration={delayMs}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>

        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="left"
            sideOffset={10}
            collisionPadding={8}
            className="z-50 w-[300px] rounded-xl border border-border-strong bg-popover p-3 text-[0.72rem] leading-5 text-foreground shadow-[var(--shadow-popover)] data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
          >
            {hint}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
