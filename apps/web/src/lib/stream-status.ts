import { useEffect, useSyncExternalStore } from 'react'
import type { StreamConnectionState } from './event-stream.ts'

/**
 * Where the event stream stands, held outside React so the shell can read it
 * without owning it. The stream belongs to a task and is opened on the task's
 * own screen; the mark that reports it lives in the sidebar, one component tree
 * above. No screen is open to a task means no stream, which is not the same
 * claim as a broken one — hence `null`.
 */
const listeners = new Set<() => void>()
let current: StreamConnectionState | null = null

function emitChange(): void {
  for (const listener of listeners) listener()
}

export function getStreamStatus(): StreamConnectionState | null {
  return current
}

export function subscribeToStreamStatus(listener: () => void): () => void {
  listeners.add(listener)

  return () => void listeners.delete(listener)
}

export function useStreamStatus(): StreamConnectionState | null {
  return useSyncExternalStore(subscribeToStreamStatus, getStreamStatus, () => null)
}

/**
 * Publishes this screen's stream state for the shell to read, and takes it back
 * down on the way out — a task screen left behind must not leave a stale
 * `reconnecting` burning in the sidebar of the screen that replaced it.
 */
export function usePublishStreamStatus(state: StreamConnectionState): void {
  useEffect(() => {
    current = state
    emitChange()

    return () => {
      current = null
      emitChange()
    }
  }, [state])
}
