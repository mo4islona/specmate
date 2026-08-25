import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reading what a repository's stages have recorded as worth remembering.
 *
 * This is the read half only. Seeding a stage's copy, admitting what it wrote
 * back under a lock, the ceilings and the eviction all arrive with the
 * `repo-memory` change; the names and shapes here are that change's, so when it
 * lands its fuller module supersedes this file wholesale and every caller keeps
 * working. Until then a store that no stage has written simply lists nothing,
 * which is the honest answer for a repository nothing has been learned about.
 */

/** The provider reads this index every run; it is the store's reachability contract. */
export const MEMORY_INDEX = 'MEMORY.md'
/** Where a linked repository's entries are seeded, read-only. */
export const LINKED_DIR = 'linked'

/** An entry's identity within a store: its file name, or `linked/<repo>/<file>` when borrowed. */
export type MemoryEntryId = string

export interface MemoryProvenance {
  readonly taskId: string | null
  readonly stageId: string | null
  readonly role: string | null
  readonly writtenAt: string | null
}

export interface MemoryEntry {
  readonly id: MemoryEntryId
  readonly name: string
  readonly description: string
  readonly bytes: number
  readonly provenance: MemoryProvenance
  /** The repository key an entry is borrowed from, or null when the store owns it. */
  readonly borrowedFrom: string | null
}

/** File names a store accepts. `MEMORY.md` is derived, so it is never an entry. */
const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/

export function isEntryName(name: string): boolean {
  return name !== MEMORY_INDEX && ENTRY_NAME.test(name)
}

/** Everything a store holds, read without the lock: a torn read costs a stale list, not a wrong write. */
export async function listStore(storeDir: string): Promise<MemoryEntry[]> {
  const own = await readEntries(storeDir, null)
  const linkedRoot = join(storeDir, LINKED_DIR)
  const borrowed: MemoryEntry[] = []
  for (const repoKey of await subdirectories(linkedRoot)) {
    borrowed.push(...(await readEntries(join(linkedRoot, repoKey), repoKey)))
  }

  return [...own, ...borrowed]
}

export function splitFrontmatter(
  text: string,
): { frontmatter: Record<string, unknown>; body: string } | null {
  if (!text.startsWith('---\n')) return null

  const end = text.indexOf('\n---', 3)
  if (end === -1) return null

  const raw = text.slice(4, end + 1)
  const body = text.slice(end + 4)

  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(raw)
  } catch {
    return null
  }

  return isRecord(parsed) ? { frontmatter: parsed, body } : null
}

/**
 * A store written by an older version, or an entry whose frontmatter the agent
 * malformed, still has to list: the index is derived from what is here, and a
 * throw would take the whole store out over one file.
 */
function readEntryText(id: MemoryEntryId, text: string, borrowedFrom: string | null): MemoryEntry {
  const parsed = splitFrontmatter(text)
  const frontmatter = parsed?.frontmatter ?? {}
  const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {}
  const specmate = isRecord(metadata.specmate) ? metadata.specmate : {}
  const stem = (id.split('/').at(-1) ?? id).replace(/\.md$/, '')

  return {
    id,
    name: text_(frontmatter.name) ?? stem,
    description: text_(frontmatter.description) ?? firstLine(parsed?.body ?? text) ?? stem,
    bytes: Buffer.byteLength(text),
    provenance: {
      taskId: text_(specmate.taskId),
      stageId: text_(specmate.stageId),
      role: text_(specmate.role),
      writtenAt: text_(specmate.writtenAt) ?? text_(metadata.modified),
    },
    borrowedFrom,
  }
}

async function readEntries(dir: string, borrowedFrom: string | null): Promise<MemoryEntry[]> {
  const names = (await readdir(dir).catch(() => [])).filter(isEntryName).toSorted()
  const prefix = borrowedFrom ? `${LINKED_DIR}/${borrowedFrom}/` : ''

  return Promise.all(
    names.map(async (name) =>
      readEntryText(`${prefix}${name}`, await readFile(join(dir, name), 'utf8'), borrowedFrom),
    ),
  )
}

async function subdirectories(dir: string): Promise<string[]> {
  const found = await readdir(dir, { withFileTypes: true }).catch(() => [])

  return found.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

function firstLine(body: string): string | null {
  return (
    body
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? null
  )
}

function text_(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
