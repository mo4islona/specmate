/**
 * The index is `tasks`; everything belonging to one task hangs off `task`.
 *
 * The two prefixes are deliberately different words. React Query matches
 * invalidations by prefix, so while the index was `['tasks']` and a task's own
 * keys were `['tasks', id, …]`, invalidating the index invalidated every query
 * of every task — the timeline, the decisions, the artifacts, and the file diff
 * that shells out to git. One event on the stream refetched the whole screen.
 */
export const queryKeys = {
  attention: ['attention'] as const,
  tasks: ['tasks'] as const,
  task: (taskId: string) => ['task', taskId] as const,
  events: (taskId: string) => ['task', taskId, 'events'] as const,
  conversations: (taskId: string) => ['task', taskId, 'conversations'] as const,
  conversation: (taskId: string, conversationId: string) =>
    ['task', taskId, 'conversations', conversationId] as const,
  artifacts: (taskId: string) => ['task', taskId, 'artifacts'] as const,
  decisions: (taskId: string) => ['task', taskId, 'decisions'] as const,
  artifact: (taskId: string, artifactId: string) =>
    ['task', taskId, 'artifacts', artifactId] as const,
  diffFiles: (taskId: string) => ['task', taskId, 'diff', 'files'] as const,
  diffFile: (taskId: string, path: string) => ['task', taskId, 'diff', 'file', path] as const,
  modelDefaults: ['settings', 'model-defaults'] as const,
  defaultRepository: ['settings', 'default-repository'] as const,
  specConventions: ['settings', 'spec-conventions'] as const,
  repositories: ['repositories'] as const,
}
