import { AGENT_ROLES } from '@specmate/core'
import type { TaskDetail } from '../lib/api-client.ts'

type ModelBindings = TaskDetail['task']['modelBindings']

export function ModelBindingsPanel({ modelBindings }: { modelBindings: ModelBindings }) {
  return (
    <section className="panel p-4 sm:p-5" aria-label="Models">
      <p className="micro-label text-phosphor">Per role</p>
      <h2 className="mt-2 text-lg font-semibold">Models</h2>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {AGENT_ROLES.map((role) => (
          <div
            key={role}
            className="flex items-center justify-between gap-2 border border-border p-2"
          >
            <dt className="font-mono text-xs text-muted">{role}</dt>
            <dd className="font-mono text-xs text-text">
              {modelBindings[role].model} · {modelBindings[role].reasoningEffort}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
