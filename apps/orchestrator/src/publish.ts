import { type ActionNode, forwardTarget, type PinnedGraph, type TaskState } from '@specmate/core'
import { type Database, pullRequests, repositories, type Task, tasks } from '@specmate/db'
import {
  type Git,
  githubRepository,
  mirrorPath,
  recordedMirrorKey,
  taskBranch,
  type WorkspaceConfig,
} from '@specmate/workspace'
import { and, eq } from 'drizzle-orm'
import { emitEvent } from './store.ts'

export class PublishError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublishError'
  }
}

export class Publisher {
  constructor(
    private readonly options: {
      db: Database
      git: Git
      workspaceConfig: WorkspaceConfig
      token: () => Promise<string>
      fetch?: typeof fetch
    },
  ) {}

  async run(task: Task, graph: PinnedGraph, node: ActionNode): Promise<void> {
    if (node.key !== 'publish') {
      throw new PublishError(`no action handler is registered for ${node.key}`)
    }

    try {
      if (!(await this.hasPullRequest(task.id))) await this.createPullRequest(task)

      await this.advance(task.id, node, graph)
    } catch (error) {
      await this.fail(task.id, node.key, error)

      throw error
    }
  }

  private async hasPullRequest(taskId: string): Promise<boolean> {
    const existing = await this.options.db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.taskId, taskId))
      .limit(1)

    return existing.length > 0
  }

  private async createPullRequest(task: Task): Promise<void> {
    const repository = githubRepository(task.repoUrl)
    if (!repository) {
      throw new PublishError(`publish only supports GitHub repository URLs: ${task.repoUrl}`)
    }

    const branch = taskBranch(task.slug)
    const [record] = await this.options.db
      .select({ mirrorKey: repositories.mirrorKey })
      .from(repositories)
      .where(eq(repositories.id, task.repositoryId))
      .limit(1)
    if (!record) throw new PublishError(`task names a repository that has no record: ${task.id}`)

    const mirror = mirrorPath(this.options.workspaceConfig, recordedMirrorKey(record.mirrorKey))
    await this.pushBranch(mirror, task.repoUrl, branch)

    const body = await this.readSummary(mirror, task.slug, branch)
    const url = await this.openPullRequest({ repository, task, branch, body })

    // A crash (or any failure) between openPullRequest() succeeding and this
    // insert lands here again on retry: hasPullRequest() still says no PR is
    // recorded, so createPullRequest() re-runs and openPullRequest() finds the
    // PR it already opened rather than creating a duplicate. Guard the insert
    // itself too, since two such retries can race past hasPullRequest() and
    // both resolve the same URL.
    await this.options.db
      .insert(pullRequests)
      .values({ taskId: task.id, url, state: 'open' })
      .onConflictDoNothing({ target: pullRequests.url })
  }

  private async pushBranch(mirror: string, repoUrl: string, branch: string): Promise<void> {
    const auth = await this.options.git.authEnv(repoUrl)
    try {
      await this.options.git.inMirror(mirror, ['push', 'origin', `${branch}:${branch}`], {
        env: auth,
      })
    } catch (error) {
      throw new PublishError(
        `push failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async readSummary(mirror: string, slug: string, branch: string): Promise<string> {
    try {
      const result = await this.options.git.inMirror(mirror, [
        'show',
        `${branch}:openspec/changes/${slug}/summary.md`,
      ])

      return result.stdout
    } catch (error) {
      throw new PublishError(
        `reading summary.md failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private async openPullRequest(options: {
    repository: string
    task: Task
    branch: string
    body: string
  }): Promise<string> {
    const accessToken = await this.options.token()
    const fetcher = this.options.fetch ?? fetch
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    let response: Response
    try {
      response = await fetcher(`https://api.github.com/repos/${options.repository}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          head: options.branch,
          base: options.task.baseBranch,
          title: options.task.title,
          body: options.body,
        }),
      })
    } catch (error) {
      throw new PublishError(
        `pull request request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const created = (await response.json().catch(() => ({}))) as {
      html_url?: string
      message?: string
    }
    if (response.ok && created.html_url) {
      return created.html_url
    }

    // GitHub rejects a second POST for a head/base pair that already has an
    // open PR. A retry after a crash between the first POST and the local DB
    // write hits exactly this, so look the PR back up rather than fail again.
    if (response.status === 422) {
      const existing = await this.findOpenPullRequest(
        options.repository,
        options.branch,
        headers,
        fetcher,
      )
      if (existing) return existing
    }

    throw new PublishError(
      `pull request creation failed: ${created.message ?? response.statusText}`,
    )
  }

  private async findOpenPullRequest(
    repository: string,
    branch: string,
    headers: Record<string, string>,
    fetcher: typeof fetch,
  ): Promise<string | null> {
    const [owner] = repository.split('/')
    const response = await fetcher(
      `https://api.github.com/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      { headers },
    ).catch(() => undefined)
    if (!response?.ok) return null

    const pulls = (await response.json().catch(() => [])) as { html_url?: string }[]

    return pulls[0]?.html_url ?? null
  }

  private async advance(taskId: string, node: ActionNode, graph: PinnedGraph): Promise<void> {
    const to = forwardTarget(graph, node.key)
    await this.options.db.transaction(async (tx) => {
      const advanced = await tx
        .update(tasks)
        .set({ status: to, updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), eq(tasks.status, node.key)))
        .returning({ id: tasks.id })
      if (advanced.length > 0) {
        await emitEvent(tx, { taskId, type: 'task.published', payload: { to } })
      }
    })
  }

  private async fail(taskId: string, status: TaskState, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error)
    await this.options.db.transaction(async (tx) => {
      const failed = await tx
        .update(tasks)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), eq(tasks.status, status)))
        .returning({ id: tasks.id })
      if (failed.length > 0) {
        await emitEvent(tx, { taskId, type: 'task.failed', payload: { reason } })
      }
    })
  }
}
