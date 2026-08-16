#!/usr/bin/env bun
/**
 * Lint stable spec IDs across openspec/ (openspec-standard rules 1, 5, 7).
 *
 * Errors: duplicate ID definitions, dangling references, RENAMED operations
 * that change or drop an ID, MODIFIED/REMOVED targeting unknown requirements,
 * and two active changes allocating the same new ID in parallel.
 *
 * REQ/AC numbers are banded per capability (openspec/id-bands.yaml); an ID
 * outside its capability's band is an error.
 *
 *   bun scripts/lint-spec-ids.ts            lint; exit 1 on errors
 *   bun scripts/lint-spec-ids.ts --strict   ID-less headers in living specs are errors
 *   bun scripts/lint-spec-ids.ts --next     print the next free ID per capability
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SUITE = join(ROOT, 'openspec')

const BANDS = ['REQ', 'INV', 'AC', 'ADR', 'LIV', 'FM', 'OB', 'P'] as const
const ID_RE = new RegExp(String.raw`\b(${BANDS.join('|')})-(\d+)\b`, 'g')
const FIRST_ID_RE = new RegExp(String.raw`\b(${BANDS.join('|')})-(\d+)\b`)
const HEADER_RE = /^(#{3,4})\s+(?:Requirement|Scenario):\s+(.*)$/
const SECTION_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\b/

// ADR-007 and ADR-7 are the same ID; keys normalize the number.
function idKey(band: string, num: string): string {
  return `${band}-${Number(num)}`
}

function firstId(text: string): string | null {
  const m = text.match(FIRST_ID_RE)
  return m ? idKey(m[1], m[2]) : null
}

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  const glob = new Bun.Glob('**/*.md')
  return [...glob.scanSync({ cwd: dir, absolute: true })].sort()
}

function readLines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n')
}

const rel = (p: string) => relative(ROOT, p)
const args = new Set(process.argv.slice(2))

// --- Capability band registry (openspec/id-bands.yaml) ---------------------

const registryFile = join(SUITE, 'id-bands.yaml')
const bandStarts = new Map<string, number>()
let bandSize = 100

for (const line of readLines(registryFile)) {
  const size = line.match(/^bandSize:\s*(\d+)/)
  if (size) {
    bandSize = Number(size[1])
    continue
  }

  const entry = line.match(/^ {2}([a-z0-9-]+):\s*(\d+)/)
  if (entry) bandStarts.set(entry[1], Number(entry[2]))
}

// The capability is the directory the spec file lives under:
// openspec/specs/<capability>/... or openspec/changes/<c>/specs/<capability>/...
function capabilityOf(file: string): string | null {
  const m = rel(file).match(/(?:^|\/)specs\/([^/]+)\//)
  return m ? m[1] : null
}

// --next: for each capability, one greater than the highest number ever used
// in its band anywhere in the suite, archive included — gaps stay reserved.
if (args.has('--next')) {
  const maxInBand = new Map<string, number>()

  for (const file of mdFiles(SUITE)) {
    for (const line of readLines(file)) {
      for (const m of line.matchAll(ID_RE)) {
        if (m[1] !== 'REQ' && m[1] !== 'AC') continue

        const n = Number(m[2])
        for (const [capability, start] of bandStarts) {
          if (n < start || n >= start + bandSize) continue

          const slot = `${capability}/${m[1]}`
          maxInBand.set(slot, Math.max(maxInBand.get(slot) ?? 0, n))
        }
      }
    }
  }

  for (const [capability, start] of bandStarts) {
    const nextReq = (maxInBand.get(`${capability}/REQ`) ?? start - 1) + 1
    const nextAc = (maxInBand.get(`${capability}/AC`) ?? start - 1) + 1
    console.info(`${capability}: REQ-${nextReq}, AC-${nextAc}`)
  }

  const nextBand = Math.max(...bandStarts.values()) + bandSize
  console.info(`next free band: ${nextBand}`)
  process.exit(0)
}

const errors: string[] = []

function checkBand(id: string, file: string, line: number): void {
  const [prefix, numText] = id.split('-')
  if (prefix !== 'REQ' && prefix !== 'AC') return

  const capability = capabilityOf(file)
  if (!capability) return

  const loc = `${rel(file)}:${line}`
  const start = bandStarts.get(capability)

  if (start === undefined) {
    errors.push(`capability "${capability}" has no band in openspec/id-bands.yaml (${loc})`)
    return
  }

  const n = Number(numText)
  if (n < start || n >= start + bandSize) {
    errors.push(
      `${id} is outside the ${capability} band ${start}..${start + bandSize - 1} at ${loc}`,
    )
  }
}

// --- Canonical definitions: living specs and ADR files ---------------------

type Site = { file: string; line: number }
const at = (s: Site) => `${rel(s.file)}:${s.line}`

const defs = new Map<string, Site[]>()

function addDef(id: string, site: Site): void {
  const sites = defs.get(id) ?? []
  sites.push(site)
  defs.set(id, sites)
}

let headersWithoutIds = 0

for (const file of mdFiles(join(SUITE, 'specs'))) {
  readLines(file).forEach((text, i) => {
    const header = text.match(HEADER_RE)
    if (!header) return

    const id = firstId(header[2])
    if (id) {
      addDef(id, { file, line: i + 1 })
      checkBand(id, file, i + 1)
    } else {
      headersWithoutIds++
    }
  })
}

for (const file of mdFiles(join(SUITE, 'decisions'))) {
  const m = basename(file).match(/^ADR-(\d+)/)
  if (m) addDef(idKey('ADR', m[1]), { file, line: 1 })
}

const livingIds = new Set(defs.keys())

for (const [id, sites] of defs) {
  if (sites.length > 1) {
    errors.push(`duplicate definition of ${id}: ${sites.map(at).join(', ')}`)
  }
}

// --- Active changes: delta semantics and pending allocations ---------------

const changesDir = join(SUITE, 'changes')
const changeNames = readdirSync(changesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== 'archive')
  .map((e) => e.name)
  .sort()

const pendingByChange = new Map<string, Set<string>>()

for (const change of changeNames) {
  const pending = new Set<string>()
  pendingByChange.set(change, pending)

  for (const file of mdFiles(join(changesDir, change, 'specs'))) {
    let section = ''
    let fromId: string | null = null
    let fromSeen = false

    readLines(file).forEach((text, i) => {
      const loc = `${rel(file)}:${i + 1}`

      const sec = text.match(SECTION_RE)
      if (sec) {
        section = sec[1]
        fromSeen = false
        return
      }

      if (section === 'RENAMED') {
        const from = text.match(/^-\s+FROM:\s*`(.+)`/)
        if (from) {
          fromId = firstId(from[1])
          fromSeen = true
          return
        }

        const to = text.match(/^-\s+TO:\s*`(.+)`/)
        if (to && fromSeen) {
          const toId = firstId(to[1])

          if (fromId && toId && fromId !== toId) {
            errors.push(`RENAMED changes ID ${fromId} -> ${toId} at ${loc}`)
          } else if (fromId && !toId) {
            errors.push(`RENAMED drops ID ${fromId} at ${loc}`)
          } else if (!fromId && toId) {
            // Adoption: a legacy ID-less header gains an ID — a fresh allocation.
            if (livingIds.has(toId)) {
              errors.push(`RENAMED adopts already-defined ${toId} at ${loc}`)
            } else {
              pending.add(toId)
              checkBand(toId, file, i + 1)
            }
          }

          fromSeen = false
        }
        return
      }

      const header = text.match(HEADER_RE)
      if (!header) return

      const id = firstId(header[2])
      if (!id) return

      const isRequirement = header[1] === '###'

      if (section === 'ADDED') {
        if (livingIds.has(id)) {
          errors.push(`ADDED redefines already-defined ${id} at ${loc}`)
        } else {
          pending.add(id)
          checkBand(id, file, i + 1)
        }
        return
      }

      if (section === 'MODIFIED' || section === 'REMOVED') {
        const known = livingIds.has(id) || pending.has(id)

        if (isRequirement && !known) {
          errors.push(`${section} targets unknown requirement ${id} at ${loc}`)
        }

        // A scenario inside a MODIFIED block may be brand new — an allocation.
        if (!isRequirement && !livingIds.has(id)) {
          pending.add(id)
          checkBand(id, file, i + 1)
        }
      }
    })
  }
}

const pendingOwner = new Map<string, string>()

for (const [change, pending] of pendingByChange) {
  for (const id of pending) {
    const owner = pendingOwner.get(id)
    if (owner) {
      errors.push(`parallel allocation of ${id} by changes "${owner}" and "${change}"`)
    } else {
      pendingOwner.set(id, change)
    }
  }
}

// --- Dangling references (archive is historical and exempt) ----------------

const universe = new Set([...defs.keys(), ...pendingOwner.keys()])
const archivePrefix = join(SUITE, 'changes', 'archive')

for (const file of mdFiles(SUITE)) {
  if (file.startsWith(archivePrefix)) continue

  readLines(file).forEach((text, i) => {
    for (const m of text.matchAll(ID_RE)) {
      const id = idKey(m[1], m[2])
      if (!universe.has(id)) {
        errors.push(`dangling reference ${id} at ${rel(file)}:${i + 1}`)
      }
    }
  })
}

// --- Report ----------------------------------------------------------------

if (args.has('--strict') && headersWithoutIds > 0) {
  errors.push(`${headersWithoutIds} requirement/scenario header(s) without IDs (strict mode)`)
}

for (const error of errors.sort()) {
  console.error(`ERROR ${error}`)
}

const idCount = universe.size
const summary = `${idCount} ID(s), ${errors.length} error(s)`

if (errors.length > 0) {
  console.error(`spec-id lint failed: ${summary}`)
  process.exit(1)
}

if (headersWithoutIds > 0) {
  console.info(
    `spec-id lint passed: ${summary}; ${headersWithoutIds} header(s) not yet carrying IDs`,
  )
} else {
  console.info(`spec-id lint passed: ${summary}`)
}
