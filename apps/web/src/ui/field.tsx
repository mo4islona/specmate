import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SelectPrimitive from '@radix-ui/react-select'
import { type ComponentPropsWithRef, createContext, type ReactNode, useContext, useId } from 'react'
import { cn } from './cn.ts'
import { Icon } from './icon.tsx'
import { ErrorNote, Note } from './note.tsx'

interface FieldContextValue {
  readonly id: string
  readonly invalid: boolean
  readonly describedBy: string | undefined
}

/**
 * How a control finds the label above it. Passing the id, the invalid flag and
 * the error's id down by hand is four attributes per field, and the field that
 * forgot one is the field a screen reader reads as unlabelled.
 */
const FieldContext = createContext<FieldContextValue | null>(null)

interface FieldProps {
  readonly label: ReactNode
  /** A sentence between the label and the control — what an empty value means. */
  readonly hint?: ReactNode
  readonly error?: ReactNode
  /** Only when something outside has to point at the control; otherwise generated. */
  readonly id?: string
  readonly className?: string
  readonly children: ReactNode
}

/** The label's face: mono, small, spaced, and the same everywhere it appears. */
const LABEL =
  'block font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground'

/**
 * The label's own face, for the headings that name a group of controls rather
 * than one control — a row of repository choices, a grid of role bindings.
 * A single control gets its label from `Field`.
 */
export function FieldLabel({ className, children, ...rest }: ComponentPropsWithRef<'p'>) {
  return (
    <p className={cn(LABEL, className)} {...rest}>
      {children}
    </p>
  )
}

/** A label, a control, and the two things that can be said about it. One rhythm. */
export function Field({ label, hint, error, id, className, children }: FieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const errorId = `${fieldId}-error`
  const context: FieldContextValue = {
    id: fieldId,
    invalid: Boolean(error),
    describedBy: error ? errorId : undefined,
  }

  return (
    <div className={className}>
      <label className={LABEL} htmlFor={fieldId}>
        {label}
      </label>

      {hint && (
        <Note size="xs" className="mt-1">
          {hint}
        </Note>
      )}

      <FieldContext.Provider value={context}>
        <div className="mt-2">{children}</div>
      </FieldContext.Provider>

      {error && <ErrorNote id={errorId}>{error}</ErrorNote>}
    </div>
  )
}

/**
 * The same height as the buttons it stands next to. A field 0.25rem taller than
 * the Save beside it is a row that never quite lines up.
 *
 * A field is not a state, so it brightens rather than colours: the frame steps
 * up the neutral ramp under the pointer and again under the caret.
 */
const CONTROL = [
  'min-h-[2.4rem] rounded-lg border border-input bg-background px-[0.7rem] py-2',
  'text-[0.8rem] leading-[1.4] text-foreground placeholder:text-muted-foreground',
  'transition-[background-color,border-color,color] duration-[120ms] ease-[ease]',
  'hover:border-[color-mix(in_srgb,var(--color-foreground)_22%,var(--color-border-strong))]',
  'focus:border-[color-mix(in_srgb,var(--color-foreground)_45%,var(--color-border-strong))]',
  'aria-invalid:border-destructive',
].join(' ')

interface ControlProps {
  /** For a value that is an identifier rather than prose — a URL, a branch, a model. */
  readonly mono?: boolean
  /** Off for the handful of controls sized to their content, like a number beside a chip. */
  readonly fullWidth?: boolean
}

function useControl(
  mono: boolean,
  fullWidth: boolean,
  id: string | undefined,
  className: string | undefined,
) {
  const field = useContext(FieldContext)

  return {
    id: id ?? field?.id,
    className: cn(CONTROL, fullWidth && 'w-full', mono && 'font-mono', className),
    'aria-invalid': field?.invalid ? true : undefined,
    'aria-describedby': field?.describedBy,
  }
}

export function Input({
  mono = false,
  fullWidth = true,
  id,
  className,
  ...rest
}: ComponentPropsWithRef<'input'> & ControlProps) {
  const control = useControl(mono, fullWidth, id, className)

  return <input {...control} {...rest} />
}

export function Textarea({
  mono = false,
  fullWidth = true,
  id,
  className,
  ...rest
}: ComponentPropsWithRef<'textarea'> & ControlProps) {
  const control = useControl(mono, fullWidth, id, className)

  return <textarea {...control} {...rest} />
}

/**
 * A tick with its word beside it. The label is part of the control because the
 * two are never apart, and a bare checkbox with a `<span>` next to it is a
 * target the size of the box rather than of the phrase.
 *
 * Radix draws the box as a button and keeps a real input beside it for a form to
 * submit, which is what retired the old trick: an icon absolutely positioned
 * over a `peer-checked` input, because the two rotated borders everyone else
 * uses turn a square about its own centre while the mark they make hangs below
 * and left of it.
 */
export function Checkbox({
  label,
  className,
  id,
  ...rest
}: ComponentPropsWithRef<typeof CheckboxPrimitive.Root> & { readonly label: ReactNode }) {
  const generated = useId()
  const boxId = id ?? generated

  return (
    // Pointed at by id rather than by wrapping: Radix does render a real input
    // inside, but it is behind a component, so nothing reading this file — a
    // linter, or a person — can see that the label has anything to name.
    <label
      htmlFor={boxId}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 text-muted-foreground text-xs',
        // The word goes quiet with the box. A live label beside a dead tick
        // reads as a checkbox you may still click.
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-[0.38]',
        className,
      )}
    >
      <CheckboxPrimitive.Root
        id={boxId}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-[0.3rem] border border-border-strong bg-secondary',
          'transition-[background-color,border-color] duration-[120ms] ease-[ease]',
          'not-disabled:hover:border-[color-mix(in_srgb,var(--color-success)_60%,var(--color-border-strong))]',
          'data-[state=checked]:border-success data-[state=checked]:bg-success',
          'focus-visible:outline-offset-1',
        )}
        {...rest}
      >
        <CheckboxPrimitive.Indicator className="flex text-background">
          <Icon name="check" size="xs" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  )
}

/**
 * Radix refuses an item whose value is the empty string — it is how it spells
 * "nothing is chosen", so an option cannot also mean it. Half the selects in
 * this app offer exactly that as a choice ("Use default"), so the empty string
 * is carried across the boundary as this instead, and callers keep writing `''`.
 */
const EMPTY = '__empty__'

interface SelectProps extends ControlProps {
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly id?: string
  readonly className?: string
  readonly children: ReactNode
  readonly 'aria-label'?: string
}

/**
 * The value, and the one mark that says the value can be changed.
 *
 * The list is ours rather than the operating system's, which is the whole reason
 * to carry Radix here: a native `<select>` opens a menu the page cannot theme,
 * cannot measure and cannot keep on screen — under `matrix` or `solarized-light`
 * it was the one surface in the app still wearing the OS's colours.
 */
export function Select({
  mono = false,
  fullWidth = true,
  value,
  defaultValue,
  onValueChange,
  disabled,
  placeholder,
  id,
  className,
  children,
  ...rest
}: SelectProps) {
  const field = useContext(FieldContext)

  return (
    <SelectPrimitive.Root
      value={value === '' ? EMPTY : value}
      defaultValue={defaultValue === '' ? EMPTY : defaultValue}
      onValueChange={(next) => onValueChange?.(next === EMPTY ? '' : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id ?? field?.id}
        aria-invalid={field?.invalid ? true : undefined}
        aria-describedby={field?.describedBy}
        className={cn(
          CONTROL,
          'flex items-center justify-between gap-2 text-start',
          'disabled:cursor-not-allowed disabled:opacity-[0.38]',
          fullWidth ? 'w-full' : 'inline-flex',
          mono && 'font-mono',
          className,
        )}
        {...rest}
      >
        {/* Truncated on the value rather than the box: a model id is longer than
            the column it sits in, and the chevron is not something to overrun. */}
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <Icon name="chevron-down" className="shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-[18rem] min-w-[var(--radix-select-trigger-width)] overflow-hidden',
            'rounded-[0.75rem] border border-border-strong bg-popover shadow-[var(--shadow-popover)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <SelectPrimitive.Viewport className="scroll-thin max-h-[18rem] overflow-y-auto p-1">
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/** One answer on the list. `''` is allowed here and means "nothing chosen". */
export function SelectOption({
  value,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      value={value === '' ? EMPTY : value}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pe-2 ps-7',
        'text-[0.8rem] leading-[1.4] text-foreground outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-[0.38]',
        className,
      )}
      {...rest}
    >
      <span className="absolute start-1.5 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <Icon name="check" size="xs" className="text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}
