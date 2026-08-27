import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom keeps one document across a file's tests; without this, a query in the
// second test can match the first test's markup and pass for the wrong reason.
afterEach(cleanup)

/**
 * What jsdom does not implement and Radix's overlays call unconditionally.
 * A select opens by capturing the pointer, keeps the chosen row in view, and
 * measures its trigger to size the list — in jsdom each of those is a missing
 * method rather than a no-op, so the component throws on the first click.
 *
 * They are stubs, not simulations: nothing here is under test. What is under
 * test is what the component does once it is open, which is why the geometry
 * can be zero.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
}
