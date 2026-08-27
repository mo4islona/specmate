import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins class names and lets the last one win.
 *
 * The merge is what makes "a call site owns its layout" true. It used to be true
 * for free: the parts were classes in the components layer, a caller's utility
 * sat in the layer after it, and the cascade settled it. Under shadcn a part
 * *is* utilities, so `px-4` from the variant and `px-8` from the caller are two
 * rules of equal weight and the winner is whichever Tailwind happened to emit
 * last — which is alphabetical, and has nothing to do with who wrote what.
 * `twMerge` drops the earlier of the pair instead, so the attribute's order
 * decides again.
 *
 * It only knows Tailwind's own shapes. A class it does not recognise — `panel`,
 * `diff-line-add` — passes through untouched, which is why this is safe to use
 * on the parts that are still written in CSS.
 */
export function cn(...parts: readonly ClassValue[]): string {
  return twMerge(clsx(parts))
}
