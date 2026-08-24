import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

/**
 * The classes that lay an element out rather than dress one. Everything else in
 * the components layer is a part, and a part comes from the kit. These are the
 * page's gutter, a rail's inset, a scroll pane's thin bar, the two animations,
 * and the two document faces — stylesheets for content rather than parts
 * anyone assembles.
 */
const LAYOUT_CLASSES = new Set([
  'shell-main',
  'shell-column',
  'rail-inset',
  'scroll-thin',
  'attention-pulse',
  'dot-live',
  'mark-reach',
  'artifact-document',
  'diff-document',
  'diff-line',
  'diff-line-add',
  'diff-line-remove',
  'diff-line-hunk',
  'diff-line-meta',
  'diff-line-context',
])

/** Utility prefixes whose value is a colour, and so must resolve to a theme role. */
const COLOUR_PREFIXES = new Set([
  'text',
  'bg',
  'border',
  'decoration',
  'divide',
  'fill',
  'stroke',
  'outline',
  'ring',
  'from',
  'via',
  'to',
])

/**
 * The values those prefixes take that are not colours — sizes, sides, styles,
 * keywords. Anything else after one of them has to be a `--color-*` the theme
 * defines, which is what catches a `text-cyan` in a palette that has no cyan.
 */
const NOT_A_COLOUR = new Set(
  // One line per family, which a formatter would take apart if this were an array.
  `xs sm base lg xl
   left center right justify start end
   wrap nowrap balance pretty ellipsis clip
   transparent current inherit none auto
   cover contain fixed local scroll top bottom repeat no-repeat
   solid dashed dotted double hidden wavy from-font
   collapse separate spacing
   t r b l x y s e
   gradient-to-t gradient-to-b gradient-to-l gradient-to-r
   gradient-to-tl gradient-to-tr gradient-to-bl gradient-to-br`.split(/\s+/),
)

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The classes the components layer defines — the app's own parts and its layout. */
function definedClasses(): Set<string> {
  const layer = CSS.slice(CSS.indexOf('@layer components {'))
  const selectors = stripComments(layer).matchAll(/^\s*\.([a-z][a-z0-9-]*)/gm)

  return new Set([...selectors].map((match) => match[1] as string))
}

/** The roles the theme names, which is the whole palette a utility may reach for. */
function paletteRoles(): Set<string> {
  const roles = CSS.matchAll(/--color-([a-z][a-z0-9-]*)\s*:/g)

  return new Set([...roles].map((match) => match[1] as string))
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(path, found)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      found.push(path)
    }
  }

  return found
}

function literalsIn(source: string): string[] {
  const matches = source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)

  return [...matches].map((match) => match[1] ?? match[2] ?? match[3] ?? '')
}

/**
 * Every class list the file hands to an element: the quoted form, and whatever
 * strings are inside an expression container — a `cx(…)`, a ternary, a lookup
 * in a tone map spelled inline.
 *
 * Reading `className` rather than every string in the file is what keeps a
 * specimen named `"chip"` on the workbench page, or a sentence that happens to
 * contain the word `control`, from being read as a use of the part.
 */
function classLists(source: string): string[] {
  const text = stripComments(source)
  const lists: string[] = []
  const attribute = /className\s*=\s*/g

  for (let match = attribute.exec(text); match !== null; match = attribute.exec(text)) {
    let index = match.index + match[0].length
    const opener = text[index]

    if (opener === '"' || opener === "'") {
      const end = text.indexOf(opener, index + 1)
      if (end === -1) continue

      lists.push(text.slice(index + 1, end))
      attribute.lastIndex = end + 1
      continue
    }

    if (opener !== '{') continue

    // A template literal's `${` opens a brace it also closes, so plain depth
    // counting reaches the right `}`.
    let depth = 0
    const start = index
    for (; index < text.length; index++) {
      if (text[index] === '{') depth += 1
      else if (text[index] === '}') {
        depth -= 1
        if (depth === 0) {
          index += 1
          break
        }
      }
    }

    lists.push(...literalsIn(text.slice(start + 1, index - 1)))
    attribute.lastIndex = index
  }

  return lists
}

/** `hover:`, `sm:`, `peer-focus-visible:` — the utility is the last segment. */
function bareUtility(token: string): string {
  return (token.split(':').at(-1) ?? token).replace(/^!/, '')
}

const ALL_FILES = sourceFiles(SRC)
const OUTSIDE_THE_KIT = ALL_FILES.filter((path) => !path.startsWith(join(SRC, 'ui')))

function relative(path: string): string {
  return path.slice(SRC.length + 1)
}

describe('kit discipline', () => {
  /**
   * The line the kit is worth anything for. A `panel` or a `button-primary`
   * written at a call site is a part assembled by hand, and a part assembled by
   * hand is a part that drifts: five settings sections wrote their own heading
   * rhythm, three popovers picked three widths, and one form asked for a
   * `.input` that does not exist and so rendered as bare browser chrome.
   */
  it('the app writes no kit class of its own', () => {
    const parts = new Set([...definedClasses()].filter((name) => !LAYOUT_CLASSES.has(name)))
    const offences: string[] = []

    for (const path of OUTSIDE_THE_KIT) {
      const used = classLists(readFileSync(path, 'utf8'))
        .flatMap((list) => list.split(/\s+/))
        .filter((token) => parts.has(token))

      for (const name of new Set(used)) offences.push(`${relative(path)} writes .${name}`)
    }

    expect(offences, 'use the primitive from src/ui, or add one there').toEqual([])
  })

  /**
   * A colour utility naming a role the theme does not define generates no CSS
   * at all, so the element simply inherits and nobody notices until they happen
   * to look at that one screen. A `text-cyan` sat on a Settings eyebrow this
   * way. Read over every class list, the kit's own included — the palette is
   * the same everywhere.
   */
  it('every colour utility names a role the theme defines', () => {
    const palette = paletteRoles()
    const offences: string[] = []

    for (const path of ALL_FILES) {
      const tokens = classLists(readFileSync(path, 'utf8')).flatMap((list) => list.split(/\s+/))

      for (const token of new Set(tokens)) {
        const [prefix, ...rest] = bareUtility(token).split('-')
        const value = rest.join('-')

        if (!prefix || !COLOUR_PREFIXES.has(prefix)) continue
        // A digit, a slash or a bracket makes it a size, an opacity or an
        // arbitrary value rather than a role.
        if (!/^[a-z]+(-[a-z]+)*$/.test(value)) continue
        if (NOT_A_COLOUR.has(value) || palette.has(value)) continue

        offences.push(`${relative(path)} writes ${token}`)
      }
    }

    expect(offences, 'name a --color-* role from theme.css').toEqual([])
  })

  it('reads the stylesheet it is checking against', () => {
    const parts = definedClasses()

    expect(parts.has('panel')).toBe(true)
    expect(parts.has('button-primary')).toBe(true)
    expect(paletteRoles().has('accent')).toBe(true)
    // The class four Settings fields asked for and never had.
    expect(parts.has('input')).toBe(false)
  })

  it('reads a class list out of both attribute forms', () => {
    const source = [
      'const a = <p className="panel space-y-5" />',
      "const b = <p className={cx('subpanel', open && 'chip')} />",
      'const c = <Specimen name="chip" />',
    ].join('\n')

    expect(classLists(source)).toEqual(['panel space-y-5', 'subpanel', 'chip'])
  })
})
