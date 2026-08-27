/**
 * The kit — every part this app is drawn from, and the only place its own
 * classes are written down.
 *
 * The design itself is not here: the colours live in `theme/theme.css` and the
 * parts they dress live in `index.css`, in Tailwind's components layer. What
 * these files add is a name, a typed set of choices, and one answer per
 * question — how far a section's heading sits under its eyebrow, how wide a
 * popover is, what a pending button says. Written out at each call site, those
 * answers drifted: five settings sections had three rhythms between them, three
 * popovers had three widths, and one form asked for a class that does not
 * exist and so rendered as bare browser chrome.
 *
 * A primitive takes a `className` and appends it last. That is deliberate — a
 * call site owns its layout, its margins and its width. What it must not own is
 * the part itself, and `kit-discipline.test.ts` is what holds that line: the
 * classes defined in the components layer may only be written inside this
 * directory.
 *
 * Everything here is on `/kit`, in every theme, in every state.
 */
export { Badge, type BadgeTone } from './badge.tsx'
export { Button, ButtonLink, type ButtonVariant, buttonVariants, IconButton } from './button.tsx'
export { Chip } from './chip.tsx'
export { cn } from './cn.ts'
export { Console, ConsoleDock, ConsoleField, type ConsoleTone } from './console.tsx'
export { Diff, type DiffView } from './diff.tsx'
export { Drawer } from './drawer.tsx'
export {
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectOption,
  Textarea,
} from './field.tsx'
export { Meter, StatBar } from './gauge.tsx'
export { HoverHint } from './hover-hint.tsx'
export { ICON_NAMES, ICON_SIZES, Icon, type IconName, type IconSize } from './icon.tsx'
export { InlineLink, QuietLink } from './link.tsx'
export {
  Skeleton,
  SkeletonFacts,
  SkeletonRows,
  SkeletonText,
  Waiting,
  Working,
} from './loading.tsx'
export {
  Dot,
  EmptyState,
  ErrorNote,
  MicroLabel,
  Note,
  TextButton,
  type Tone,
  toneClass,
} from './note.tsx'
export { PageHeader, Panel, PanelLink, Section, Subpanel } from './panel.tsx'
export { Popover, type PopoverSide } from './popover.tsx'
export { ErrorState, LoadingState, type WaitShape } from './query-state.tsx'
export { Reveal } from './reveal.tsx'
export { FolderName, ListRow, NavRow } from './rows.tsx'
