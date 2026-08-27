import type { ComponentPropsWithRef, FormHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from './cn.ts'

/**
 * The state the block is in, as the accent it wears. `plain` is a console with
 * nothing particular to say, which is most of the time.
 */
export type ConsoleTone = 'plain' | 'asking' | 'stopped' | 'spent'

const TONE: Record<ConsoleTone, string> = {
  plain: '',
  asking: 'console-asking',
  stopped: 'console-stopped',
  spent: 'console-spent',
}

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
    <form className={cn('console', TONE[tone], className)} {...rest}>
      {children}
    </form>
  )
}

/** The field itself: no frame of its own, and as tall as what is in it. */
export function ConsoleField({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={cn('console-field', className)} {...rest} />
}

/**
 * What the console sits in when a record scrolls above it — the thread's last
 * lines dissolve into it rather than stopping at a rule.
 */
export function ConsoleDock({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('console-dock', className)} {...rest}>
      {children}
    </div>
  )
}
