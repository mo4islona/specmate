import type { WorkspaceConfig } from './config.ts'
import { githubRepository } from './paths.ts'

export interface GitResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Strips embedded HTTP Basic credentials (`https://user:token@host/...`) before an arg list is ever logged, stored, or surfaced to an operator. */
function redact(args: readonly string[]): string[] {
  return args.map((arg) => arg.replace(/(:\/\/[^/@]+:)[^@]+(@)/, '$1***$2'))
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${redact(args).join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`)
    this.name = 'GitError'
  }
}

export interface SpawnedProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
}

export interface SpawnSpec {
  readonly cmd: string[]
  readonly cwd?: string
  readonly env: Record<string, string | undefined>
}

export type GitSpawn = (spec: SpawnSpec) => SpawnedProcess

export const spawnGit: GitSpawn = (spec) =>
  Bun.spawn({
    cmd: spec.cmd,
    cwd: spec.cwd,
    env: spec.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

/**
 * Git must never ask a human anything: a stage waiting on a credential prompt
 * looks exactly like a hung agent. Everything that could prompt is disabled,
 * and the server's own git config is taken out of the picture so behaviour does
 * not depend on whoever set up the box.
 */
export function gitEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    LC_ALL: 'C',
  }
}

export class Git {
  constructor(
    private readonly config: WorkspaceConfig,
    private readonly spawn: GitSpawn = spawnGit,
  ) {}

  /** Identity travels per invocation; nothing is written to a config file. */
  private get identity(): string[] {
    return [
      '-c',
      `user.name=${this.config.authorName}`,
      '-c',
      `user.email=${this.config.authorEmail}`,
    ]
  }

  async tryRun(
    args: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<GitResult> {
    const proc = this.spawn({
      cmd: ['git', ...this.identity, ...args],
      cwd: options.cwd,
      env: { ...process.env, ...gitEnv(), ...options.env },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  }

  async run(
    args: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<GitResult> {
    const result = await this.tryRun(args, options)

    if (result.exitCode !== 0) {
      throw new GitError(args, result)
    }

    return result
  }

  /**
   * Per-invocation credential for a GitHub HTTPS remote, injected as a git
   * config value via the environment. Unlike a token embedded in the remote
   * URL, this never lands in a persisted remote config (`remote set-url`)
   * or in an argv string a failure could echo back (`GitError`'s message).
   */
  async authEnv(repoUrl: string): Promise<Record<string, string> | undefined> {
    const repository = githubRepository(repoUrl)
    if (!repository || !this.config.githubToken) {
      return undefined
    }

    const token = await this.config.githubToken()
    const credential = Buffer.from(`x-access-token:${token}`).toString('base64')

    return {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${credential}`,
    }
  }

  /**
   * Operations on the bare cache repository. `-C` rather than `--git-dir`:
   * worktree subcommands need git to discover the repository, not be handed a
   * detached git dir.
   */
  async inMirror(
    mirror: string,
    args: string[],
    options: { env?: Record<string, string> } = {},
  ): Promise<GitResult> {
    return this.run(['-C', mirror, ...args], options)
  }

  async tryInMirror(
    mirror: string,
    args: string[],
    options: { env?: Record<string, string> } = {},
  ): Promise<GitResult> {
    return this.tryRun(['-C', mirror, ...args], options)
  }
}
