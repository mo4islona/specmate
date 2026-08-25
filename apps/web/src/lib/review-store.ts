import type { DiffView } from '../ui/index.ts'

/**
 * What one browser remembers about reading a task's diff: which files this
 * reader has been through, and whether they read in one column or two.
 *
 * Both belong to the person at the screen rather than to the task, so both stay
 * here rather than in the server's settings — the same trade the theme picker
 * takes (`theme/themes.ts`). A browser that refuses storage still reads the
 * diff; it just starts its pass again next time.
 */

const passKey = (taskId: string) => `specmate.files-viewed.${taskId}`
const VIEW_KEY = 'specmate.diff-view'

interface StoredPass {
  readonly tip: string
  readonly paths: readonly string[]
}

export interface ViewedPass {
  readonly paths: ReadonlySet<string>
  /** Marks were left on an older comparison, so they no longer say anything. */
  readonly moved: boolean
}

const EMPTY_PASS: ViewedPass = { paths: new Set(), moved: false }

function parsePass(raw: string): StoredPass | null {
  const stored: unknown = JSON.parse(raw)
  if (typeof stored !== 'object' || stored === null) return null

  const { tip, paths } = stored as Partial<StoredPass>
  if (typeof tip !== 'string' || !Array.isArray(paths)) return null

  return { tip, paths: paths.filter((path) => typeof path === 'string') }
}

/**
 * A mark is a claim about the diff it was left on (REQ-916). A tip that has
 * moved is therefore a pass that is gone, not a pass to carry forward — and
 * one worth saying out loud, since the reader left those marks deliberately.
 */
export function readPass(taskId: string, tip: string): ViewedPass {
  try {
    const raw = localStorage.getItem(passKey(taskId))
    if (raw === null) return EMPTY_PASS

    const stored = parsePass(raw)
    if (stored === null) return EMPTY_PASS

    if (stored.tip === tip) return { paths: new Set(stored.paths), moved: false }

    return { paths: new Set(), moved: stored.paths.length > 0 }
  } catch {
    return EMPTY_PASS
  }
}

export function writePass(taskId: string, tip: string, paths: ReadonlySet<string>): void {
  try {
    localStorage.setItem(passKey(taskId), JSON.stringify({ tip, paths: [...paths] }))
  } catch {
    // Storage denied: the pass still counts on screen, it just will not survive
    // a reload.
  }
}

export function readDiffView(): DiffView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

export function storeDiffView(view: DiffView): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Same as above: the choice holds for this visit and no longer.
  }
}
