import type { ComponentPropsWithRef, FormHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from './cn.ts'

/**
 * The state the block is in, as the accent it wears. `plain` is a console with
 * nothing particular to say, which is most of the time.
 *
 * The tone is one custom property the block reads twice — as its frame under the
 * caret, and as the glow behind that frame. Neutral until the state has
 * something to say: a console that lit the brand whenever it held the caret was
 * the loudest thing on a screen where nothing was happening.
 */
export type ConsoleTone = 'plain' | 'asking' | 'stopped' | 'spent'

const TONE: Record<ConsoleTone, string> = {
  plain: '',
  asking: '[--console-tone:var(--color-warning)]',
  stopped: '[--console-tone:var(--color-destructive)]',
  spent: '[--console-tone:var(--color-muted-foreground)]',
}

/**
 * Depth carries what a frame used to carry, and the state's colour appears in
 * two places only — the mark that opens the block, and the button that acts. The
 * rail down the left side said the same thing a third time.
 */
const CONSOLE = [
  '[--console-tone:var(--color-foreground)]',
  'rounded-2xl border border-border bg-popover',
  'transition-[border-color,box-shadow] duration-[140ms] ease-[ease]',
  'focus-within:border-[color-mix(in_srgb,var(--console-tone)_22%,var(--color-border))]',
  'focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--console-tone)_6%,transparent)]',
].join(' ')

interface ConsoleProps extends FormHTMLAttributes<HTMLFormElement> {
  readonly tone?: ConsoleTone
}

/**
 * Where the owner speaks. This app has one input, and both places a person
 * types into it — launching a task and answering a running one — are the same
 * block, so that sending reads as one thing moving rather than two widgets
 * exchanging text.
 */
export function Console({ tone = 'plain', className, children, ...rest }: ConsoleProps) {
  return (
    <form className={cn(CONSOLE, TONE[tone], className)} {...rest}>
      {children}
    </form>
  )
}

const FIELD = [
  'block w-full min-h-[2.4rem] max-h-[38vh] overflow-y-auto',
  'border-0 bg-transparent p-0 text-[0.9rem] leading-[1.65] text-foreground',
  'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground',
  // Its height is what is in it. A fixed box with a drag handle in the corner is
  // furniture, and nobody drags it.
  'resize-none',
].join(' ')

/** The field itself: no frame of its own, and as tall as what is in it. */
export function ConsoleField({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={cn(FIELD, className)} {...rest} />
}

/**
 * The thread has no floor. Its last lines dissolve into the console rather than
 * stopping at a rule: reading and writing are one column.
 *
 * The fade is shorter than the padding the thread reserves under its last line,
 * so it lands on empty space. At 2rem against no reserve it was washing out the
 * bottom half of whatever line the record ended on.
 */
const DOCK = [
  'relative',
  'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6',
  'before:bg-[linear-gradient(to_top,var(--color-background),transparent)]',
].join(' ')

/**
 * What the console sits in when a record scrolls above it — the thread's last
 * lines dissolve into it rather than stopping at a rule.
 */
export function ConsoleDock({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(DOCK, className)} {...rest}>
      {children}
    </div>
  )
}
