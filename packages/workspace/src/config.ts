import { resolve } from 'node:path'

export interface WorkspaceConfig {
  /** Absolute root holding `mirrors/` and `tasks/`. */
  readonly root: string
  readonly authorName: string
  readonly authorEmail: string
  /** Obtains the orchestrator-held GitHub credential when a GitHub remote is used. */
  readonly githubToken?: () => Promise<string>
  /** Schema recorded in a scaffolded change folder. */
  readonly changeSchema: string
  /** How often a held mirror lock refreshes its heartbeat. */
  readonly lockHeartbeatMs: number
  /** A lock whose heartbeat is older than this is considered abandoned. */
  readonly lockStaleMs: number
  /** How long a waiter blocks before failing instead of proceeding unlocked. */
  readonly lockWaitMs: number
  /** Artifact snapshots stored for the UI are truncated at this many bytes. */
  readonly snapshotLimitBytes: number
}

export const DEFAULT_WORKSPACE_CONFIG = {
  root: 'workspaces',
  authorName: 'SpecMate',
  authorEmail: 'specmate@localhost',
  changeSchema: 'spec-driven',
  lockHeartbeatMs: 2_000,
  lockStaleMs: 15_000,
  lockWaitMs: 15 * 60_000,
  snapshotLimitBytes: 256 * 1024,
} as const satisfies Omit<WorkspaceConfig, 'githubToken'>

export type WorkspaceOptions = Partial<WorkspaceConfig>

export function resolveWorkspaceConfig(options: WorkspaceOptions = {}): WorkspaceConfig {
  const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined))
  const merged = { ...DEFAULT_WORKSPACE_CONFIG, ...defined } as WorkspaceConfig
  // Takeover is decided by heartbeat age; a stale window under one beat would
  // declare a live holder dead on its first pause.
  if (merged.lockStaleMs <= merged.lockHeartbeatMs * 2) {
    throw new Error('lockStaleMs must be more than twice lockHeartbeatMs')
  }
  return { ...merged, root: resolve(merged.root) }
}
