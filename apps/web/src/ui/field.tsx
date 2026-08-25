import { type ComponentPropsWithRef, createContext, type ReactNode, useContext, useId } from 'react'
import { cx } from './cx.ts'
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

/**
 * The label's own face, for the headings that name a group of controls rather
 * than one control — a row of repository choices, a grid of role bindings.
 * A single control gets its label from `Field`.
 */
export function FieldLabel({ className, children, ...rest }: ComponentPropsWithRef<'p'>) {
  return (
    <p className={cx('field-label', className)} {...rest}>
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
      <label className="field-label" htmlFor={fieldId}>
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
    className: cx('control', fullWidth && 'w-full', mono && 'font-mono', className),
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

/**
 * A tick with its word beside it. The label is part of the control because the
 * two are never apart, and a bare checkbox with a `<span>` next to it is a
 * target the size of the box rather than of the phrase.
 */
export function Checkbox({
  label,
  className,
  ...rest
}: ComponentPropsWithRef<'input'> & { readonly label: ReactNode }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-1.5 text-muted text-xs', className)}>
      <input type="checkbox" className="checkbox" {...rest} />
      {label}
    </label>
  )
}

export function Select({
  mono = false,
  fullWidth = true,
  id,
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'select'> & ControlProps) {
  const control = useControl(mono, fullWidth, id, className)

  return (
    <select {...control} {...rest}>
      {children}
    </select>
  )
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
