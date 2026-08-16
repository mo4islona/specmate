export const queryKeys = {
  attention: ['attention'] as const,
  tasks: ['tasks'] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  events: (taskId: string) => ['tasks', taskId, 'events'] as const,
  artifacts: (taskId: string) => ['tasks', taskId, 'artifacts'] as const,
  artifact: (taskId: string, artifactId: string) =>
    ['tasks', taskId, 'artifacts', artifactId] as const,
}
