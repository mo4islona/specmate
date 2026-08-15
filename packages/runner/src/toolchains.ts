import type { DeclaredToolchain, ResolvedToolchain } from '@specmate/core'

const EXACT_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
const VERSION_RANGE = /[<>=~^|*,]|\s+-\s|(?:^|\.)x(?:\.|$)/i

export const SUPPORTED_TOOLCHAINS = new Set(['bun', 'go', 'node', 'python', 'rust'])

export class UnsupportedToolchainError extends Error {
  constructor(name: string) {
    super(`toolchain "${name}" is not supported by the universal runner`)
    this.name = 'UnsupportedToolchainError'
  }
}

export class ToolchainResolutionError extends Error {
  constructor(toolchain: DeclaredToolchain, detail: string) {
    const request = toolchain.version ? `@${toolchain.version}` : ''
    super(`could not resolve ${toolchain.name}${request}: ${detail}`)
    this.name = 'ToolchainResolutionError'
  }
}

export function exactVersion(request: string | undefined): string | null {
  if (!request) return null

  return EXACT_VERSION.exec(request.trim())?.[1] ?? null
}

export function isVersionRange(request: string): boolean {
  return VERSION_RANGE.test(request.trim())
}

export function parseRemoteVersions(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('mise returned a non-array version list')

  return parsed.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (!isRecord(entry) || typeof entry.version !== 'string') return []

    return [entry.version]
  })
}

export function selectVersion(
  toolchain: DeclaredToolchain,
  availableVersions: readonly string[],
): ResolvedToolchain {
  if (!SUPPORTED_TOOLCHAINS.has(toolchain.name)) throw new UnsupportedToolchainError(toolchain.name)
  const request = toolchain.version?.trim()
  if (!request) {
    throw new ToolchainResolutionError(
      toolchain,
      'a version list is required for an unpinned declaration',
    )
  }

  const constraint = request.replaceAll('===', '=').replaceAll(',', ' ')
  const matches = availableVersions.filter((version) => satisfies(version, constraint))
  matches.sort((left, right) => compareVersions(right, left))
  const version = matches[0]
  if (!version) throw new ToolchainResolutionError(toolchain, 'no available version satisfies it')

  return { name: toolchain.name, version }
}

export function resolvedToolchain(
  toolchain: DeclaredToolchain,
  version: string,
): ResolvedToolchain {
  if (!SUPPORTED_TOOLCHAINS.has(toolchain.name)) throw new UnsupportedToolchainError(toolchain.name)
  const resolved = exactVersion(version)
  if (!resolved) {
    throw new ToolchainResolutionError(
      toolchain,
      `mise returned non-exact version "${version.trim()}"`,
    )
  }

  return { name: toolchain.name, version: resolved }
}

export function toolSpec(toolchain: ResolvedToolchain): string {
  return `${toolchain.name}@${toolchain.version}`
}

function satisfies(version: string, constraint: string): boolean {
  try {
    return Bun.semver.satisfies(version, constraint)
  } catch {
    return false
  }
}

function compareVersions(left: string, right: string): number {
  try {
    return Bun.semver.order(left, right)
  } catch {
    return 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
