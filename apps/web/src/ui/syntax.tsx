import type { Element, RootContent } from 'hast'
import type { ReactNode } from 'react'

type Refractor = typeof import('refractor/core')['refractor']

/** The engine and its grammars, once they are here. Null is "read it in one colour". */
let grammars: Refractor | null = null
let arriving: Promise<void> | null = null

/**
 * Fetches the languages a diff is drawn in.
 *
 * Each grammar carries its own dependencies — `tsx` brings markup, clike,
 * javascript, jsx and typescript with it — so this list is longer than it
 * reads, and together with the engine under it they were a sixth of everything
 * the app shipped before anyone had opened a task. They arrive when the first
 * diff comes near the viewport instead.
 *
 * Nothing waits on them: a language the app cannot read has always rendered as
 * plain text, and a language it can read simply renders that way until they
 * land. The colours are spans around text that is already on the screen, so
 * taking them changes no height and moves nothing.
 */
export function loadSyntax(): Promise<void> {
  if (arriving) return arriving

  arriving = (async () => {
    const [{ refractor }, ...languages] = await Promise.all([
      import('refractor/core'),
      import('refractor/tsx'),
      import('refractor/css'),
      import('refractor/json'),
      import('refractor/yaml'),
      import('refractor/markdown'),
      import('refractor/bash'),
      import('refractor/python'),
      import('refractor/rust'),
      import('refractor/go'),
      import('refractor/sql'),
      import('refractor/toml'),
    ])

    for (const language of languages) refractor.register(language.default)
    grammars = refractor
  })()

  return arriving
}

/** Whether the grammars are here, so a caller can draw coloured on its first render. */
export function syntaxReady(): boolean {
  return grammars !== null
}

/**
 * The five colours a diff is read in. Prism names forty kinds of token; a
 * palette of forty is a screen with no rank left in it, so they collapse to the
 * distinctions that are actually worth a hue — and everything unnamed is the
 * reading colour, which is most of any file.
 */
type SyntaxRole = 'comment' | 'string' | 'keyword' | 'number' | 'name' | 'punctuation'

const ROLES: Record<string, SyntaxRole> = {
  cdata: 'comment',
  comment: 'comment',
  doctype: 'comment',
  prolog: 'comment',

  'attr-value': 'string',
  char: 'string',
  regex: 'string',
  string: 'string',
  url: 'string',

  atrule: 'keyword',
  deleted: 'keyword',
  important: 'keyword',
  keyword: 'keyword',
  selector: 'keyword',
  tag: 'keyword',

  boolean: 'number',
  constant: 'number',
  entity: 'number',
  inserted: 'number',
  number: 'number',
  symbol: 'number',

  'attr-name': 'name',
  builtin: 'name',
  'class-name': 'name',
  function: 'name',
  property: 'name',
  title: 'name',

  namespace: 'punctuation',
  operator: 'punctuation',
  punctuation: 'punctuation',
}

/** The extensions worth naming. Everything else reads as text (AC-1063). */
const LANGUAGES: Record<string, string> = {
  bash: 'bash',
  c: 'clike',
  cjs: 'javascript',
  css: 'css',
  go: 'go',
  h: 'clike',
  htm: 'markup',
  html: 'markup',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  svg: 'markup',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

/**
 * The grammar a path is written in, or null where nothing here reads it. The
 * table above is the whole answer — asking the engine whether it has the
 * grammar would make this a question nobody can ask before the grammars arrive,
 * and every entry in that table is one of the eleven or a dependency of them.
 */
export function languageOf(path: string | undefined): string | null {
  if (!path) return null

  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? name : name.slice(dot + 1)

  return LANGUAGES[extension] ?? null
}

/** The role a Prism token wears here, or null where it earns no colour of its own. */
function roleOf(node: Element): SyntaxRole | null {
  const names = node.properties?.className
  if (!Array.isArray(names)) return null

  for (const name of names) {
    const role = typeof name === 'string' ? ROLES[name] : undefined
    if (role) return role
  }

  return null
}

/**
 * The tokenized text, cut back into the lines it came from.
 *
 * Prism tokenizes a document and a token may run across a newline — a block
 * comment is one token five lines long. So the tree is walked flat, carrying
 * the innermost role each stretch of text is under, and every newline in it
 * starts a new line of output. Splitting like this is why the whole side is
 * tokenized at once: a `/** ` line and the ` * ` lines under it are one comment
 * only if they are read together.
 */
function cutIntoLines(nodes: readonly RootContent[]): ReactNode[][] {
  const lines: ReactNode[][] = [[]]
  let key = 0

  const walk = (children: readonly RootContent[], under: SyntaxRole | null): void => {
    for (const node of children) {
      if (node.type === 'element') {
        walk(node.children, roleOf(node) ?? under)
        continue
      }
      if (node.type !== 'text') continue

      const parts = node.value.split('\n')
      for (const [index, part] of parts.entries()) {
        if (index > 0) lines.push([])
        if (part === '') continue

        key += 1
        lines.at(-1)?.push(
          under === null ? (
            part
          ) : (
            <span key={key} className={`syntax-${under}`}>
              {part}
            </span>
          ),
        )
      }
    }
  }

  walk(nodes, null)

  return lines
}

/**
 * One side of a change, coloured — the lines as they were, or as they will be.
 *
 * Each side is tokenized as the document it is rather than a line at a time: a
 * line of a JSDoc block, read alone, is not a comment at all, and colouring it
 * as an operator and a stray constant is worse than not colouring it. What the
 * other side holds is a blank line here, which keeps this array line-for-line
 * with the rows the caller is drawing.
 */
export function highlightSide(
  lines: readonly string[],
  language: string | null,
): readonly ReactNode[][] {
  const plain = () => lines.map((line) => [line])
  if (language === null || grammars === null) return plain()

  try {
    const cut = cutIntoLines(grammars.highlight(lines.join('\n'), language).children)

    // A grammar that dropped or invented a newline would slide every line under
    // the wrong one, which is worse than no colour at all.
    return cut.length === lines.length ? cut : plain()
  } catch {
    return plain()
  }
}
