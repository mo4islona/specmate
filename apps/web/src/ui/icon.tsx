import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleHelp,
  CircleSmall,
  Ellipsis,
  File,
  GitBranch,
  GitPullRequest,
  Info,
  type LucideIcon,
  Maximize2,
  Minus,
  Settings,
  Square,
  X,
} from 'lucide-react'
import { cn } from './cn.ts'

/**
 * Every icon this app draws, and the only file that names lucide.
 *
 * Before this there were three ways to put a mark on screen: a path copied out
 * of Octicons, a path copied out of Feather, and a literal `⌄` or `✓` typed
 * into the JSX. The third is why the chevrons looked crooked — a glyph takes
 * the metrics of whatever face it lands in, so `⌄` in the mono stack sits high
 * and hairline-thin next to the word it belongs to, and no amount of `leading`
 * fixes it. The first two disagreed with each other: fill at 16 against stroke
 * at 24.
 *
 * So one set, addressed by what the mark means here rather than by what lucide
 * calls it — swapping the library, or one icon of it, is an edit to `GLYPHS`
 * and nothing else. `kit-discipline.test.ts` holds that line.
 */
const GLYPHS = {
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  close: X,
  expand: Maximize2,
  file: File,
  fold: ChevronsDownUp,
  info: Info,
  more: Ellipsis,
  'pull-request': GitPullRequest,
  repo: GitBranch,
  settings: Settings,
  stop: Square,
  unfold: ChevronsUpDown,

  // The six a pipeline node wears. They were typed characters until now — a `✓`
  // and a `○` set in the rail's mono face, which is exactly what the rule at the
  // foot of this file is about: the tick sat off the box it was meant to fill
  // and the ring was a hairline beside a solid dot.
  waiting: CircleHelp,
  running: CircleSmall,
  skipped: Minus,
  pending: Circle,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof GLYPHS

/** Every name and every size, for the workbench that has to draw them all. */
export const ICON_NAMES = Object.keys(GLYPHS).sort() as readonly IconName[]

/**
 * The sizes this interface actually asks for, in px. `xl` is the one that is
 * not a size but a picture — the mark an empty page is built around. `2xs` is
 * the other end: a mark that rides in the corner of something else and has to
 * be read as a shape rather than as a drawing.
 */
const SIZES = { '2xs': 8, xs: 12, sm: 14, md: 16, lg: 20, xl: 32 } as const

export type IconSize = keyof typeof SIZES

export const ICON_SIZES = Object.keys(SIZES) as readonly IconSize[]

/**
 * One weight for the whole set, in px rather than in the 24-unit viewBox.
 * Lucide's default scales the stroke with the box, which makes a 12px icon
 * read a third lighter than the 20px one beside it; `absoluteStrokeWidth`
 * pins it so a chevron in a chip and a gear in the sidebar share a hand.
 */
const STROKE = 1.5

/**
 * The corrections a nominal size cannot make. Lucide draws most marks inside a
 * 16-unit square of its 24-unit frame; `Circle` fills 20 of it, so at the same
 * size it reads a fifth larger than the tick standing next to it in the rail.
 * Scaling it back is what makes a column of marks look like one set.
 */
const OPTICAL: Partial<Record<IconName, string>> = {
  pending: 'scale-[0.82]',
}

interface IconProps {
  readonly name: IconName
  readonly size?: IconSize
  /** For the few marks that carry meaning no neighbouring text repeats. */
  readonly label?: string
  readonly className?: string
}

export function Icon({ name, size = 'sm', label, className }: IconProps) {
  const Glyph = GLYPHS[name]

  return (
    <Glyph
      size={SIZES[size]}
      strokeWidth={STROKE}
      absoluteStrokeWidth
      className={cn('shrink-0', OPTICAL[name], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
