import { describe, expect, it } from 'vitest'
import { cn } from './cn.ts'

describe('cn', () => {
  it('lets the call site win the pair it collides with', () => {
    expect(cn('px-4 py-2', 'px-8')).toBe('py-2 px-8')
  })

  it('leaves a class it does not recognise alone', () => {
    expect(cn('panel', 'diff-line-add', 'px-8')).toBe('panel diff-line-add px-8')
  })

  it('drops what is falsy, so a condition can be written as one', () => {
    expect(cn('chip', false, null, undefined, 'px-2')).toBe('chip px-2')
  })

  /**
   * The theme's roles are not registered with `tailwind-merge`, so it decides
   * what a `text-*` means by the shape of the value: a t-shirt size is type, and
   * anything else is colour. A role it read as a size would silently delete the
   * type beside it — `text-xs text-muted-foreground` is on most labels in the
   * app, and it would come out at the browser's default size.
   */
  it.each([
    'foreground',
    'muted-foreground',
    'primary',
    'primary-foreground',
    'warning',
    'destructive',
    'info',
    'success',
    'accent-foreground',
    'card-foreground',
    'status-active',
    'syntax-keyword',
  ])('reads text-%s as a colour rather than a size', (role) => {
    expect(cn('text-xs', `text-${role}`)).toBe(`text-xs text-${role}`)
  })

  it('still settles two colours of the same kind', () => {
    expect(cn('text-muted-foreground', 'text-primary')).toBe('text-primary')
    expect(cn('bg-card', 'bg-popover')).toBe('bg-popover')
  })
})
