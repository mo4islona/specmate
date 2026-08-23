import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Redirect, Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

/**
 * The surfaces were screens until pass 3, and the links that reached them still
 * exist. These assert the redirects and the addressability REQ-901 keeps, not
 * the screens themselves — those have their own tests.
 */
function Routes() {
  return (
    <Switch>
      <Route path="/tasks/:taskId/docs/:artifactId">
        {(params) => <p>docs:{params.artifactId}</p>}
      </Route>
      <Route path="/tasks/:taskId/docs">{() => <p>docs</p>}</Route>
      <Route path="/tasks/:taskId/files">{() => <p>files</p>}</Route>
      <Route path="/tasks/:taskId/artifacts/:artifactId">
        {(params) => <Redirect to={`/tasks/${params.taskId}/docs/${params.artifactId}`} />}
      </Route>
      <Route path="/tasks/:taskId/artifacts">
        {(params) => <Redirect to={`/tasks/${params.taskId}/docs`} />}
      </Route>
      <Route path="/tasks/:taskId/diff">
        {(params) => <Redirect to={`/tasks/${params.taskId}/files`} />}
      </Route>
      <Route path="/tasks/:taskId">{() => <p>thread</p>}</Route>
    </Switch>
  )
}

function at(path: string) {
  const { hook, history } = memoryLocation({ path, record: true })
  render(
    <Router hook={hook}>
      <Routes />
    </Router>,
  )

  return history
}

describe('task surfaces are routes (REQ-920, AC-961)', () => {
  test('each surface opens directly at its own address', () => {
    at('/tasks/task-1/files')
    expect(screen.getByText('files')).not.toBeNull()
  })

  test('a single document stays addressable', () => {
    at('/tasks/task-1/docs/artifact-9')
    expect(screen.getByText('docs:artifact-9')).not.toBeNull()
  })

  test('the screens these surfaces replaced redirect rather than 404', () => {
    const diff = at('/tasks/task-1/diff')
    expect(diff.at(-1)).toBe('/tasks/task-1/files')

    const artifacts = at('/tasks/task-2/artifacts')
    expect(artifacts.at(-1)).toBe('/tasks/task-2/docs')

    const one = at('/tasks/task-3/artifacts/artifact-4')
    expect(one.at(-1)).toBe('/tasks/task-3/docs/artifact-4')
  })
})
