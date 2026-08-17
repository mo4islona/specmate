import { createDb } from '@specmate/db'
import { Engine } from '@specmate/orchestrator/engine'
import { WorkspaceManager, WorkspaceService } from '@specmate/workspace'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const db = createDb(config.DATABASE_URL)
const workspaceManager = new WorkspaceManager({ config: { root: config.WORKSPACE_ROOT } })
const workspaceService = new WorkspaceService(workspaceManager, db, () =>
  Promise.reject(new Error('the API never provisions workspaces')),
)
const gates = new Engine({
  db,
  workspaces: {
    provision: (request) => workspaceService.provision({ ...request, image: 'pinned-by-task' }),
    provisionConversation: () =>
      Promise.reject(new Error('the API never provisions conversation workspaces')),
    releaseConversation: (task, key) =>
      workspaceService.releaseConversation(task.slug, task.repoUrl, key),
    discard: (workspace) => workspaceService.discard(workspace),
    release: (taskId) => workspaceService.release(taskId),
  },
  settings: {
    stageConcurrency: 1,
    stageAttemptCap: 1,
    availableProviders: [],
  },
  log: (message) => console.info(message),
})
const app = createApp({ db, config, gates })

const server = Bun.serve({
  port: config.API_PORT,
  fetch: app.fetch,
  development: config.NODE_ENV === 'development',
})

console.info(`specmate api listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`${signal} received, draining`)
    void server.stop(false).then(() => process.exit(0))
  })
}
