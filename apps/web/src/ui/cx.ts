/**
 * Joins class names and drops whatever is falsy, so a conditional class can be
 * written as `condition && '…'` rather than as a ternary ending in `''`.
 *
 * Order within the attribute decides nothing — the cascade goes by where a rule
 * sits in the stylesheet, and Tailwind's utilities layer comes after the
 * components layer these parts live in. A utility written at a call site
 * therefore wins over the part it is written beside, which is the whole reason
 * every primitive here takes a `className`.
 */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
