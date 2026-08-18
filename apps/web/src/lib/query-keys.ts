export const queryKeys = {
  attention: ['attention'] as const,
  tasks: ['tasks'] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  events: (taskId: string) => ['tasks', taskId, 'events'] as const,
  conversations: (taskId: string) => ['tasks', taskId, 'conversations'] as const,
  conversation: (taskId: string, conversationId: string) =>
    ['tasks', taskId, 'conversations', conversationId] as const,
  artifacts: (taskId: string) => ['tasks', taskId, 'artifacts'] as const,
  decisions: (taskId: string) => ['tasks', taskId, 'decisions'] as const,
  artifact: (taskId: string, artifactId: string) =>
    ['tasks', taskId, 'artifacts', artifactId] as const,
  diffFiles: (taskId: string) => ['tasks', taskId, 'diff', 'files'] as const,
  diffFile: (taskId: string, path: string) => ['tasks', taskId, 'diff', 'file', path] as const,
}
