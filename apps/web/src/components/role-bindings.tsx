import { AGENT_ROLES, type AgentRole, PIPELINE_CATALOG } from '@specmate/core'
import type { ReactNode } from 'react'
import { nodeLabel } from '../lib/task-thread.ts'

interface RoleGroup {
  readonly title: string
  readonly roles: readonly AgentRole[]
}

/** `spec_writer` is a key, not a name. */
function roleLabel(role: AgentRole): string {
  const words = role.replaceAll('_', ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Where each role runs, read off the pipeline itself rather than written down
 * here — the graph is the only thing that knows, and a list kept by hand goes
 * stale the first time a node moves. A role can hold two nodes: the planner
 * writes the brief and then the spec.
 */
function pipelinePlaces(): Map<AgentRole, string[]> {
  const places = new Map<AgentRole, string[]>()
  for (const node of PIPELINE_CATALOG.feature.nodes) {
    if (node.kind !== 'stage') continue

    const seen = places.get(node.role) ?? []
    places.set(node.role, [...seen, nodeLabel(node.key)])
  }

  return places
}

/**
 * Ten roles is a wall unless it is sorted by something true. These three groups
 * are the difference between a setting that changes what the next task does and
 * one that changes nothing at all, which is the first thing anyone reading this
 * screen wants to know.
 */
function roleGroups(places: Map<AgentRole, string[]>): RoleGroup[] {
  const scheduled = [...places.keys()]
  const idle = AGENT_ROLES.filter((role) => role !== 'answerer' && !places.has(role))

  return [
    { title: 'In the pipeline', roles: scheduled },
    { title: 'Outside the pipeline', roles: ['answerer'] },
    ...(idle.length > 0 ? [{ title: 'Not scheduled today', roles: idle }] : []),
  ]
}

interface RoleBindingsProps {
  /** The two controls for one role — the caller owns what a change does. */
  readonly children: (role: AgentRole) => ReactNode
}

/**
 * The roles, in pipeline order, each a row rather than a card. Ten boxes on a
 * two-column grid gave every role the weight of a section and left the values —
 * the only thing on the screen anyone came to read — in the smallest type on
 * it. A row puts the name, where it runs, and its two controls on one line, so
 * a column of ten can be scanned in one pass.
 */
export function RoleBindings({ children }: RoleBindingsProps) {
  const places = pipelinePlaces()

  return (
    <div className="space-y-6">
      {roleGroups(places).map((group) => (
        <section key={group.title}>
          <h3 className="micro-label text-muted">{group.title}</h3>

          <dl className="mt-1 divide-y divide-border/70">
            {group.roles.map((role) => (
              <div
                key={role}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 sm:flex-nowrap"
              >
                <dt className="min-w-0 flex-1 sm:basis-52">
                  <span className="block truncate text-[0.85rem] text-text">{roleLabel(role)}</span>
                  <span className="mt-0.5 block truncate font-mono text-[0.62rem] text-muted">
                    {places.get(role)?.join(' · ') ??
                      (role === 'answerer' ? 'Your questions' : 'No node runs it')}
                  </span>
                </dt>

                <dd className="w-full sm:w-auto">{children(role)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
