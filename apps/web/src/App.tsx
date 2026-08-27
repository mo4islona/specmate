import { lazy, Suspense, useEffect } from 'react'
import { Redirect, Route, Switch } from 'wouter'
import { AppShell } from './components/app-shell.tsx'
import { SecretGate } from './components/secret-gate.tsx'
import { TaskShell } from './components/task-shell.tsx'
import { AttentionScreen } from './screens/attention-screen.tsx'
import { LoadingState, MicroLabel, Panel } from './ui/index.ts'

/**
 * The inbox is what the app opens on, so it is the only screen that ships with
 * the shell. Everything past it is fetched when it is asked for.
 *
 * The cut is not arbitrary tidiness: a task's surfaces carry the two heaviest
 * things this app depends on — a markdown parser and a syntax highlighter,
 * together more than half again the weight of everything we wrote — and the
 * inbox needs neither. The workbench at `/kit` is nobody's screen at all.
 */
const TaskScreen = lazy(async () => ({
  default: (await import('./screens/task-screen.tsx')).TaskScreen,
}))
const FilesChangedScreen = lazy(async () => ({
  default: (await import('./screens/files-changed-screen.tsx')).FilesChangedScreen,
}))
const ArtifactsScreen = lazy(async () => ({
  default: (await import('./screens/artifacts-screen.tsx')).ArtifactsScreen,
}))
const NewTaskScreen = lazy(async () => ({
  default: (await import('./screens/new-task-screen.tsx')).NewTaskScreen,
}))
const SettingsScreen = lazy(async () => ({
  default: (await import('./screens/settings-screen.tsx')).SettingsScreen,
}))
const KitScreen = lazy(async () => ({
  default: (await import('./screens/kit-screen.tsx')).KitScreen,
}))

/**
 * Where the owner goes from the inbox, fetched while they are still reading it.
 * Splitting a screen off only to make opening it a wait is a trade nobody asked
 * for; this is the half that keeps the split honest. It is deliberately idle
 * work — the inbox's own requests are in flight, and this waits behind them.
 */
function usePrefetchedTaskSurface(): void {
  useEffect(() => {
    const fetch = () => void import('./screens/task-screen.tsx')
    if (typeof requestIdleCallback !== 'function') {
      const timer = setTimeout(fetch, 1_500)

      return () => clearTimeout(timer)
    }

    const idle = requestIdleCallback(fetch, { timeout: 4_000 })

    return () => cancelIdleCallback(idle)
  }, [])
}

export function App() {
  usePrefetchedTaskSurface()

  return (
    <SecretGate>
      <AppShell>
        <Suspense fallback={<LoadingState title="Opening…" shape="document" />}>
          <Switch>
            <Route path="/" component={AttentionScreen} />
            <Route path="/tasks/new" component={NewTaskScreen} />
            <Route path="/settings" component={SettingsScreen} />
            {/* Not linked from anywhere: the kit's own workbench, for whoever is changing it. */}
            <Route path="/kit" component={KitScreen} />

            <Route path="/tasks/:taskId/docs/:artifactId">
              {(params) => (
                <TaskShell taskId={params.taskId} active="docs">
                  <ArtifactsScreen taskId={params.taskId} artifactId={params.artifactId} />
                </TaskShell>
              )}
            </Route>
            <Route path="/tasks/:taskId/docs">
              {(params) => (
                <TaskShell taskId={params.taskId} active="docs">
                  <ArtifactsScreen taskId={params.taskId} />
                </TaskShell>
              )}
            </Route>
            <Route path="/tasks/:taskId/files">
              {(params) => (
                <TaskShell taskId={params.taskId} active="files">
                  <FilesChangedScreen taskId={params.taskId} />
                </TaskShell>
              )}
            </Route>

            {/* The surfaces were screens until pass 3; the links that reached them
                still exist in the inbox, in older notifications, and in the owner's
                history. REQ-901 keeps a single artifact addressable. */}
            <Route path="/tasks/:taskId/artifacts/:artifactId">
              {(params) => <Redirect to={`/tasks/${params.taskId}/docs/${params.artifactId}`} />}
            </Route>
            <Route path="/tasks/:taskId/artifacts">
              {(params) => <Redirect to={`/tasks/${params.taskId}/docs`} />}
            </Route>
            <Route path="/tasks/:taskId/diff">
              {(params) => <Redirect to={`/tasks/${params.taskId}/files`} />}
            </Route>

            <Route path="/tasks/:taskId">
              {(params) => (
                <TaskShell taskId={params.taskId} active="thread">
                  <TaskScreen taskId={params.taskId} />
                </TaskShell>
              )}
            </Route>

            <Route>
              <Panel className="text-center">
                <MicroLabel tone="destructive">404 / no route</MicroLabel>
                <h1 className="mt-3 text-2xl font-semibold">Channel not found</h1>
              </Panel>
            </Route>
          </Switch>
        </Suspense>
      </AppShell>
    </SecretGate>
  )
}
