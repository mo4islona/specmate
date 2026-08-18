import { Route, Switch } from 'wouter'
import { AppShell } from './components/app-shell.tsx'
import { SecretGate } from './components/secret-gate.tsx'
import { ArtifactsScreen } from './screens/artifacts-screen.tsx'
import { AttentionScreen } from './screens/attention-screen.tsx'
import { FilesChangedScreen } from './screens/files-changed-screen.tsx'
import { NewTaskScreen } from './screens/new-task-screen.tsx'
import { TaskScreen } from './screens/task-screen.tsx'

export function App() {
  return (
    <SecretGate>
      <AppShell>
        <Switch>
          <Route path="/" component={AttentionScreen} />
          <Route path="/tasks/new" component={NewTaskScreen} />
          <Route path="/tasks/:taskId/artifacts/:artifactId">
            {(params) => <ArtifactsScreen taskId={params.taskId} artifactId={params.artifactId} />}
          </Route>
          <Route path="/tasks/:taskId/artifacts">
            {(params) => <ArtifactsScreen taskId={params.taskId} />}
          </Route>
          <Route path="/tasks/:taskId/diff">
            {(params) => <FilesChangedScreen taskId={params.taskId} />}
          </Route>
          <Route path="/tasks/:taskId">{(params) => <TaskScreen taskId={params.taskId} />}</Route>
          <Route>
            <section className="panel p-8 text-center">
              <p className="micro-label text-danger">404 / no route</p>
              <h1 className="mt-3 text-2xl font-semibold">Channel not found</h1>
            </section>
          </Route>
        </Switch>
      </AppShell>
    </SecretGate>
  )
}
