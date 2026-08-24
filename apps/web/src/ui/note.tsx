import type { ComponentPropsWithRef, HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.ts'

/** The colour a small label wears. A role, never a hue. */
export type Tone = 'muted' | 'accent' | 'info' | 'attention' | 'danger' | 'success'

const TONE: Record<Tone, string> = {
  muted: 'text-muted',
  accent: 'text-accent',
  info: 'text-info',
  attention: 'text-attention',
  danger: 'text-danger',
  success: 'text-success',
}

export function toneClass(tone: Tone): string {
  return TONE[tone]
}

interface NoteProps extends HTMLAttributes<HTMLParagraphElement> {
  /** `sm` is a sentence under a heading; `xs` is a fact under a control. */
  readonly size?: 'sm' | 'xs'
}

const NOTE_SIZE = {
  sm: 'text-sm leading-6',
  xs: 'text-xs',
} as const

/** Anything the interface says in its quiet voice: a description, an absence, a wait. */
export function Note({ size = 'sm', className, children, ...rest }: NoteProps) {
  return (
    <p className={cx('text-muted', NOTE_SIZE[size], className)} {...rest}>
      {children}
    </p>
  )
}

interface MicroLabelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'p' | 'h2' | 'h3' | 'span'
  readonly tone?: Tone
}

/** The eyebrow over a heading, and the word that names a group in a rail. */
export function MicroLabel({
  as: Tag = 'p',
  tone = 'muted',
  className,
  children,
  ...rest
}: MicroLabelProps) {
  return (
    <Tag className={cx('micro-label', TONE[tone], className)} {...rest}>
      {children}
    </Tag>
  )
}

/** What went wrong, under the thing it went wrong in. */
export function ErrorNote({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cx('field-error', className)} {...rest}>
      {children}
    </p>
  )
}

/**
 * A verb with no frame — unclamping a document, folding it back. It is not a
 * `ghost` button: those sit in a control row and carry its height, and this one
 * lives at the end of a paragraph.
 */
export function TextButton({ className, children, ...rest }: ComponentPropsWithRef<'button'>) {
  return (
    <button
      type="button"
      className={cx('font-mono text-[0.62rem] text-info hover:underline', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

interface DotProps {
  /** The colour, as a utility — the tone vocabularies differ per surface, the geometry does not. */
  readonly className?: string
  /** Breathing, for a marker that stands for something happening now. */
  readonly live?: boolean
}

/** A state as a mark rather than a word. One size, everywhere it appears. */
export function Dot({ className, live = false }: DotProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('h-1.5 w-1.5 shrink-0 rounded-full', live && 'dot-live', className)}
    />
  )
}

interface EmptyStateProps {
  /** How much room the absence is given — it fills a pane, not a paragraph. */
  readonly height?: 'sm' | 'md' | 'lg'
  readonly mono?: boolean
  readonly className?: string
  readonly children: ReactNode
}

const EMPTY_HEIGHT = {
  sm: 'min-h-48',
  md: 'min-h-72',
  lg: 'min-h-96',
} as const

/** Nothing to show, said in the middle of the space the something would have taken. */
export function EmptyState({ height = 'sm', mono = false, className, children }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'grid place-items-center p-6 text-center text-sm text-muted',
        EMPTY_HEIGHT[height],
        mono && 'font-mono',
        className,
      )}
    >
      {children}
    </div>
  )
}
