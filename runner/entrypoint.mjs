import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const MISE = '/usr/local/bin/mise'
const EMPTY_CONFIG_ROOT = '/tmp/specmate-mise/empty'
const TOOLCHAINS_ENV = 'SPECMATE_TOOLCHAINS'

// Read by `withStartFailure`: docker exits 125/126/127 when it could not start
// the container, and a provider that propagates one of those exit codes is
// indistinguishable from that — except that this line only exists if the
// container did start. Written before anything that can fail.
process.stderr.write('specmate runner: entrypoint started\n')

const command = process.argv.slice(2)
if (command.length === 0) fail('runner command is empty')

const environment = { ...process.env }
const toolchains = parseToolchains(environment[TOOLCHAINS_ENV])
delete environment[TOOLCHAINS_ENV]

if (toolchains.length > 0) {
  mkdirSync(EMPTY_CONFIG_ROOT, { recursive: true })
  const resolved = spawnSync(
    MISE,
    ['env', '--json', ...toolchains.map(({ name, version }) => `${name}@${version}`)],
    {
      cwd: EMPTY_CONFIG_ROOT,
      env: { ...environment, MISE_NOT_FOUND_AUTO_INSTALL: 'false' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  if (resolved.error) fail(resolved.error.message)
  if (resolved.status !== 0) fail(`pinned toolchain activation exited ${resolved.status ?? 1}`)

  Object.assign(environment, parseEnvironment(resolved.stdout))
}

const executed = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: environment,
  stdio: 'inherit',
})
if (executed.error) fail(executed.error.message)
process.exit(executed.status ?? (executed.signal ? 128 : 1))

function parseToolchains(raw) {
  if (!raw) return []

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('pinned toolchains are not valid JSON')
  }
  if (!Array.isArray(parsed)) fail('pinned toolchains must be an array')

  return parsed.map((toolchain) => {
    if (
      typeof toolchain !== 'object' ||
      toolchain === null ||
      typeof toolchain.name !== 'string' ||
      toolchain.name.length === 0 ||
      typeof toolchain.version !== 'string' ||
      toolchain.version.length === 0
    ) {
      fail('every pinned toolchain must have a name and exact version')
    }

    return { name: toolchain.name, version: toolchain.version }
  })
}

function parseEnvironment(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('mise returned an invalid environment')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('mise returned a non-object environment')
  }

  return Object.fromEntries(Object.entries(parsed).filter((entry) => typeof entry[1] === 'string'))
}

function fail(message) {
  process.stderr.write(`specmate runner: ${message}\n`)
  process.exit(1)
}
