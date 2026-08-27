import type { HTMLAttributes, ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from './cn.ts'
import { MicroLabel, Note, type Tone } from './note.tsx'

interface PanelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'section' | 'div' | 'aside' | 'article'
  /** For a panel whose contents run to its frame: a scrolling document, a full-width list. */
  readonly flush?: boolean
}

/**
 * A panel carries its own inset. Six call sites each choosing one is how a
 * settings page ended up with four different left edges down one column.
 *
 * The inset is a variable rather than a number because it is also arithmetic:
 * the task column's height is the viewport less the gutter it sits in, and a
 * literal in each place is a literal that drifts.
 */
const PANEL =
  'rounded-2xl border border-[color-mix(in_srgb,var(--color-border)_72%,transparent)] bg-[color-mix(in_srgb,var(--color-card)_94%,transparent)] p-[var(--panel-inset)]'

/** The app's one surface. It carries its own inset, so no call site picks one. */
export function Panel({
  as: Tag = 'section',
  flush = false,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag className={cn(PANEL, flush && 'p-0', className)} {...rest}>
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
    <Link href={href} className={cn(PANEL, className)}>
      {children}
    </Link>
  )
}

interface SubpanelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'div' | 'li' | 'section'
}

/**
 * `bg-muted` is the wash a block one step in from a panel wears, and it is the
 * same 3.5% of the text this rule was written with before shadcn had a name for
 * it. Not `.block`: that is Tailwind's own display utility, and taking the name
 * painted a background on every element in the app that asked to be one.
 */
const SUBPANEL = 'rounded-xl bg-muted p-[var(--block-inset)]'

/** One step in from a panel — a waiver, a repository, a question. */
export function Subpanel({ as: Tag = 'div', className, children, ...rest }: SubpanelProps) {
  return (
    <Tag className={cn(SUBPANEL, className)} {...rest}>
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
    <Panel className={cn('space-y-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <MicroLabel tone={eyebrowTone}>{eyebrow}</MicroLabel>}

          <h2 className={cn('text-lg font-semibold', eyebrow ? 'mt-2' : undefined)}>{title}</h2>

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
      className={cn('flex flex-col justify-between gap-4 sm:flex-row sm:items-end', className)}
    >
      <div className="min-w-0">
        {eyebrow && <MicroLabel tone={eyebrowTone}>{eyebrow}</MicroLabel>}

        <h1
          className={cn(
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
