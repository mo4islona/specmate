import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'wouter'
import { cx } from './cx.ts'
import { MicroLabel, Note, type Tone } from './note.tsx'

interface PanelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'section' | 'div' | 'aside' | 'article'
  /** For a panel whose contents run to its frame: a scrolling document, a full-width list. */
  readonly flush?: boolean
}

/** The app's one surface. It carries its own inset, so no call site picks one. */
export function Panel({
  as: Tag = 'section',
  flush = false,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag className={cx('panel', flush && 'panel-flush', className)} {...rest}>
      {children}
    </Tag>
  )
}

interface PanelLinkProps {
  readonly href: string
  readonly className?: string
  readonly children: ReactNode
}

/** A panel that is somewhere to go — an inbox card, a summary that opens. */
export function PanelLink({ href, className, children }: PanelLinkProps) {
  return (
    <Link href={href} className={cx('panel', className)}>
      {children}
    </Link>
  )
}

interface SubpanelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'div' | 'li' | 'section'
}

/** One step in from a panel — a waiver, a repository, a question. */
export function Subpanel({ as: Tag = 'div', className, children, ...rest }: SubpanelProps) {
  return (
    <Tag className={cx('subpanel', className)} {...rest}>
      {children}
    </Tag>
  )
}

interface SectionProps {
  readonly eyebrow?: ReactNode
  readonly eyebrowTone?: Tone
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Opposite the title — a reset, a way out of the whole section. */
  readonly actions?: ReactNode
  readonly className?: string
  readonly children?: ReactNode
}

/**
 * A panel with a head. Five settings sections each wrote this out and no two
 * agreed on the gap between the eyebrow, the heading and the sentence under it,
 * which is how one column ended up with three different rhythms down it.
 */
export function Section({
  eyebrow,
  eyebrowTone = 'muted',
  title,
  description,
  actions,
  className,
  children,
}: SectionProps) {
  return (
    <Panel className={cx('space-y-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <MicroLabel tone={eyebrowTone}>{eyebrow}</MicroLabel>}

          <h2 className={cx('text-lg font-semibold', eyebrow ? 'mt-2' : undefined)}>{title}</h2>

          {description && <Note className="mt-2">{description}</Note>}
        </div>

        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {children}
    </Panel>
  )
}

interface PageHeaderProps {
  readonly eyebrow?: ReactNode
  readonly eyebrowTone?: Tone
  readonly title: ReactNode
  readonly description?: ReactNode
  /** A count, a control — whatever the screen puts opposite its own name. */
  readonly aside?: ReactNode
  readonly className?: string
}

/** The one heading a screen gets. */
export function PageHeader({
  eyebrow,
  eyebrowTone = 'muted',
  title,
  description,
  aside,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cx('flex flex-col justify-between gap-4 sm:flex-row sm:items-end', className)}
    >
      <div className="min-w-0">
        {eyebrow && <MicroLabel tone={eyebrowTone}>{eyebrow}</MicroLabel>}

        <h1
          className={cx(
            'text-3xl font-semibold tracking-tight sm:text-4xl',
            eyebrow ? 'mt-2' : undefined,
          )}
        >
          {title}
        </h1>

        {description && <Note className="mt-3 max-w-2xl">{description}</Note>}
      </div>

      {aside}
    </header>
  )
}
