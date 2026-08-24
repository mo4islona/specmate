import { Redirect, Route, Switch } from 'wouter'
import { AppShell } from './components/app-shell.tsx'
import { SecretGate } from './components/secret-gate.tsx'
import { TaskShell } from './components/task-shell.tsx'
import { ArtifactsScreen } from './screens/artifacts-screen.tsx'
import { AttentionScreen } from './screens/attention-screen.tsx'
import { FilesChangedScreen } from './screens/files-changed-screen.tsx'
import { KitScreen } from './screens/kit-screen.tsx'
import { NewTaskScreen } from './screens/new-task-screen.tsx'
import { SettingsScreen } from './screens/settings-screen.tsx'
import { TaskScreen } from './screens/task-screen.tsx'
import { MicroLabel, Panel } from './ui/index.ts'

export function App() {
  return (
    <SecretGate>
      <AppShell>
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
              <MicroLabel tone="danger">404 / no route</MicroLabel>
              <h1 className="mt-3 text-2xl font-semibold">Channel not found</h1>
            </Panel>
          </Route>
        </Switch>
      </AppShell>
    </SecretGate>
  )
}
