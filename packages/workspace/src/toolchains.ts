import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeclaredToolchain } from '@specmate/core'

const DECLARATION_FILES = [
  '.mise.toml',
  '.tool-versions',
  '.nvmrc',
  '.node-version',
  '.python-version',
  'rust-toolchain.toml',
  'bun.lock',
  'Cargo.toml',
  'pyproject.toml',
  'package.json',
] as const

type DeclarationFile = (typeof DECLARATION_FILES)[number]
type TreeDeclarations = Readonly<Record<DeclarationFile, string | null>>

const TOOL_ALIASES: Readonly<Record<string, string>> = {
  nodejs: 'node',
  golang: 'go',
}

/** Detects only declarations committed at the repository root. */
export async function detectToolchains(tree: string): Promise<DeclaredToolchain[]> {
  const declarations = await readDeclarations(tree)
  const detected = new Map<string, string | undefined>()
  const addToolchain = (name: string, version?: string) => {
    const requestedName = name.trim()
    const normalizedName = TOOL_ALIASES[requestedName] ?? requestedName
    const normalizedVersion = cleanVersion(version)
    if (!normalizedName) return
    if (detected.has(normalizedName)) {
      if (detected.get(normalizedName) === undefined && normalizedVersion !== undefined) {
        detected.set(normalizedName, normalizedVersion)
      }

      return
    }
    detected.set(normalizedName, normalizedVersion)
  }

  for (const toolchain of parseMiseToml(declarations['.mise.toml'])) {
    addToolchain(toolchain.name, toolchain.version)
  }
  for (const toolchain of parseToolVersions(declarations['.tool-versions'])) {
    addToolchain(toolchain.name, toolchain.version)
  }

  declareVersionFile(declarations['.nvmrc'], 'node', addToolchain)
  declareVersionFile(declarations['.node-version'], 'node', addToolchain)
  declareVersionFile(declarations['.python-version'], 'python', addToolchain)

  const rustToolchain = declarations['rust-toolchain.toml']
  if (rustToolchain !== null) addToolchain('rust', tomlString(rustToolchain, 'channel'))

  const cargo = declarations['Cargo.toml']
  if (cargo !== null) {
    const minimumRust = tomlString(cargo, 'rust-version')
    addToolchain('rust', minimumRust === undefined ? undefined : `>=${minimumRust}`)
  }

  const pyproject = declarations['pyproject.toml']
  if (pyproject !== null) addToolchain('python', tomlString(pyproject, 'requires-python'))

  if (declarations['bun.lock'] !== null) addToolchain('bun')

  const packageJson = declarations['package.json']
  if (packageJson !== null) {
    const manifest = parsePackageJson(packageJson)
    addToolchain('node', manifest.node)
    if (manifest.bun !== undefined) addToolchain('bun', manifest.bun)
  }

  return [...detected.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, version]) => (version === undefined ? { name } : { name, version }))
}

async function readDeclarations(tree: string): Promise<TreeDeclarations> {
  const entries = await Promise.all(
    DECLARATION_FILES.map(async (path) => [path, await readOptional(join(tree, path))] as const),
  )

  return Object.fromEntries(entries) as Record<DeclarationFile, string | null>
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null

    throw error
  }
}

function parseMiseToml(contents: string | null): DeclaredToolchain[] {
  if (contents === null) return []

  const toolchains: DeclaredToolchain[] = []
  let isToolsSection = false
  for (const rawLine of contents.split('\n')) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    if (line.startsWith('[')) {
      isToolsSection = line === '[tools]'
      continue
    }
    if (!isToolsSection) continue

    const assignment = /^((?:[A-Za-z0-9_./:@+-]+)|(?:"[^"]+")|(?:'[^']+'))\s*=\s*(.+)$/.exec(line)
    if (!assignment) continue
    const name = unquote(assignment[1] ?? '')
    const value = assignment[2] ?? ''
    const inlineVersion = /\bversion\s*=\s*["']([^"']+)["']/.exec(value)?.[1]
    const directVersion = /^["']([^"']+)["']/.exec(value)?.[1]
    const arrayVersion = /^\[\s*["']([^"']+)["']/.exec(value)?.[1]
    const version = inlineVersion ?? directVersion ?? arrayVersion
    toolchains.push(version === undefined ? { name } : { name, version })
  }

  return toolchains
}

function parseToolVersions(contents: string | null): DeclaredToolchain[] {
  if (contents === null) return []

  const toolchains: DeclaredToolchain[] = []
  for (const rawLine of contents.split('\n')) {
    const [declaration] = rawLine.split('#', 1)
    const [name, version] = declaration?.trim().split(/\s+/) ?? []
    if (!name) continue
    toolchains.push(version === undefined ? { name } : { name, version })
  }

  return toolchains
}

function declareVersionFile(
  contents: string | null,
  name: string,
  addToolchain: (name: string, version?: string) => void,
): void {
  if (contents === null) return
  const version = contents
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'))
  addToolchain(name, version)
}

function tomlString(contents: string, key: string): string | undefined {
  for (const rawLine of contents.split('\n')) {
    const line = stripTomlComment(rawLine)
    const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`).exec(line)
    if (match?.[1]) return match[1]
  }

  return undefined
}

function parsePackageJson(contents: string): { node?: string; bun?: string } {
  try {
    const parsed = JSON.parse(contents) as unknown
    if (!isRecord(parsed)) return {}
    const engines = isRecord(parsed.engines) ? parsed.engines : {}
    const devEngines = isRecord(parsed.devEngines) ? parsed.devEngines : {}
    const runtime = isRecord(devEngines.runtime) ? devEngines.runtime : {}
    const devEngineNode =
      runtime.name === 'node' && typeof runtime.version === 'string' ? runtime.version : undefined
    const node = devEngineNode ?? (typeof engines.node === 'string' ? engines.node : undefined)
    const bunEngine = typeof engines.bun === 'string' ? engines.bun : undefined
    const packageManager =
      typeof parsed.packageManager === 'string'
        ? /^(?:bun)@([^+\s]+)(?:\+.*)?$/.exec(parsed.packageManager)?.[1]
        : undefined

    return { node, bun: bunEngine ?? packageManager }
  } catch {
    // Presence still declares Node even when a malformed manifest cannot add a version.
    return {}
  }
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if ((character === '"' || character === "'") && line[index - 1] !== '\\') {
      quote = quote === character ? null : (quote ?? character)
    } else if (character === '#' && quote === null) {
      return line.slice(0, index)
    }
  }

  return line
}

function unquote(value: string): string {
  const first = value[0]
  const last = value.at(-1)
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value
}

function cleanVersion(version: string | undefined): string | undefined {
  const cleaned = version?.trim()
  return cleaned ? cleaned : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}
