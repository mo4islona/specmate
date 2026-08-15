import type { WorkspaceConfig } from './config.ts'

export interface GitResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`)
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
export function gitEnv(config: WorkspaceConfig): Record<string, string> {
  const ssh = ['ssh', '-o', 'BatchMode=yes']
  if (config.sshKeyPath) ssh.push('-i', `"${config.sshKeyPath}"`, '-o', 'IdentitiesOnly=yes')
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_SSH_COMMAND: ssh.join(' '),
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

  async tryRun(args: string[], options: { cwd?: string } = {}): Promise<GitResult> {
    const proc = this.spawn({
      cmd: ['git', ...this.identity, ...args],
      cwd: options.cwd,
      env: { ...process.env, ...gitEnv(this.config) },
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  }

  async run(args: string[], options: { cwd?: string } = {}): Promise<GitResult> {
    const result = await this.tryRun(args, options)
    if (result.exitCode !== 0) throw new GitError(args, result)
    return result
  }

  /**
   * Operations on the bare cache repository. `-C` rather than `--git-dir`:
   * worktree subcommands need git to discover the repository, not be handed a
   * detached git dir.
   */
  async inMirror(mirror: string, args: string[]): Promise<GitResult> {
    return this.run(['-C', mirror, ...args])
  }

  async tryInMirror(mirror: string, args: string[]): Promise<GitResult> {
    return this.tryRun(['-C', mirror, ...args])
  }
}
