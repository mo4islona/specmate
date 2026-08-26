/**
 * Which shell calls only looked.
 *
 * A run reaches for the shell to read at least as often as to change something:
 * `sed -n '1,140p' file`, `tail -40 log`, `find … -iname`, `git diff`. REQ-915
 * keeps those out of the permanent record for the same reason it keeps `Read`
 * out of it — forty lines of looking around are how a run got to the two lines
 * that matter, not what it did.
 *
 * This is a whitelist and stays one. Anything it does not recognize — a test
 * run, an install, a commit, a script nobody here has heard of — is a change,
 * keeps its line, and is the answer this file gives whenever it is unsure.
 */

/** Commands that cannot write a file, whatever their arguments. */
const READS: ReadonlySet<string> = new Set([
  'basename',
  'cat',
  'cd',
  'cmp',
  'column',
  'comm',
  'cut',
  'date',
  'df',
  'diff',
  'dirname',
  'du',
  'echo',
  'egrep',
  'fgrep',
  'file',
  'grep',
  'head',
  'jq',
  'ls',
  'nl',
  'printf',
  'pwd',
  'readlink',
  'realpath',
  'rg',
  'sort',
  'stat',
  'tail',
  'tr',
  'tree',
  'true',
  'type',
  'uniq',
  'wc',
  'which',
  'whoami',
  'yq',
])

/** git's own read subcommands. Everything else it can do writes something. */
const GIT_READS: ReadonlySet<string> = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'diff-tree',
  'grep',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'status',
  'whatchanged',
])

/** The find predicates that stop it being a walk and make it an act. */
const FIND_WRITES: ReadonlySet<string> = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-fls',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-ok',
  '-okdir',
])

/** git's global options that swallow the word after them, so `-C x status` is still a status. */
const GIT_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
])

function gitSubcommand(args: readonly string[]): string | null {
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] as string

    if (GIT_OPTIONS_WITH_VALUE.has(arg)) {
      at++
      continue
    }
    if (arg.startsWith('-')) continue

    return arg
  }

  return null
}

/** Commands that read only under some arguments. Each says which. */
const CONDITIONAL: Record<string, (args: readonly string[]) => boolean> = {
  // `-i`, `-i.bak`, `-ni` — the flag may be bundled, and it is the whole difference.
  sed: (args) => !args.some((arg) => /^-[a-z]*i/.test(arg) || arg.startsWith('--in-place')),
  find: (args) => !args.some((arg) => FIND_WRITES.has(arg)),
  git: (args) => {
    const subcommand = gitSubcommand(args)

    return subcommand !== null && GIT_READS.has(subcommand)
  },
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** A line does something this cannot see into, so whatever it is, it is not a read. */
const OPAQUE = /\$\(|`|<\(|>\(/

/** `/usr/bin/sed` and `sed` are the same command. */
function commandName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** What the word being read belongs to: the command, or a redirection's target. */
type Role = 'word' | 'write' | 'read'

/**
 * The commands a line actually runs, quoted stretches kept whole so that
 * `grep 'a || b' file` is one command rather than two. Null where the line
 * writes into a file, which settles the question before the commands do.
 */
function commandsIn(line: string): string[][] | null {
  if (OPAQUE.test(line)) return null

  const commands: string[][] = []
  let current: string[] = []
  let word = ''
  let quote = ''
  let quoted = false
  let role: Role = 'word'
  let wrote = false

  function endWord(): void {
    if (word === '' && !quoted) return

    if (role === 'write' && word !== '/dev/null') wrote = true
    if (role === 'word') current.push(word)

    word = ''
    quoted = false
    role = 'word'
  }

  function endCommand(): void {
    endWord()
    if (current.length > 0) commands.push(current)
    current = []
  }

  for (let at = 0; at < line.length; at++) {
    const char = line[at] as string

    if (quote) {
      if (char === quote) quote = ''
      else word += char
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      quoted = true
      continue
    }

    if (char === '\\') {
      const next = line[at + 1]
      at++
      // A backslash before a newline continues the line and carries nothing.
      if (next !== undefined && next !== '\n') word += next
      continue
    }

    if (char === '>' || char === '<') {
      // `2>` names a file descriptor rather than a word of the command.
      if (/^\d*$/.test(word)) word = ''
      else endWord()

      if (line[at + 1] === char) at++

      // `>&2` redirects onto a descriptor: nothing reaches a file, and the
      // number after it is the target rather than an argument.
      role = char === '>' && line[at + 1] !== '&' ? 'write' : 'read'
      if (line[at + 1] === '&') at++

      continue
    }

    if (char === ';' || char === '|' || char === '&' || char === '\n') {
      endCommand()
      continue
    }

    if (char === ' ' || char === '\t' || char === '\r') {
      endWord()
      continue
    }

    word += char
  }

  endCommand()

  return wrote ? null : commands
}

function reads(command: readonly string[]): boolean {
  const words = [...command]
  while (words.length > 0 && ASSIGNMENT.test(words[0] as string)) words.shift()

  const name = commandName(words.shift() ?? '')
  if (name === '') return false

  const conditional = CONDITIONAL[name]

  return conditional ? conditional(words) : READS.has(name)
}

/**
 * Whether a shell call changed nothing. Every command in the line has to be a
 * read — `sed -n … || find …` looked twice and wrote nothing, `bun test > log`
 * did neither.
 */
export function isReadOnlyShell(command: string): boolean {
  const commands = commandsIn(command)
  if (commands === null || commands.length === 0) return false

  return commands.every(reads)
}
