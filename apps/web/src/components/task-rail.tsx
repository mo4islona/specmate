import type { ModelBinding } from '@specmate/core'
import { Link } from 'wouter'
import type { ArtifactSummary, TaskDetail } from '../lib/api-client.ts'
import type { PipelineNodeView } from '../lib/task-pipeline.ts'
import { BudgetPanel } from './budget-panel.tsx'
import { PipelineRail } from './pipeline-rail.tsx'

interface TaskRailProps {
  readonly taskId: string
  readonly nodes: readonly PipelineNodeView[]
  readonly baseline: ModelBinding | null
  readonly repoUrl: string
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly artifacts: readonly ArtifactSummary[]
  readonly openArtifactId: string | null
  readonly onOpenArtifact: (artifactId: string) => void
  readonly budgets: TaskDetail['task']['budgets']
  readonly spend: TaskDetail['spend']
}

const ARTIFACT_LIMIT = 8

export function TaskRail({
  taskId,
  nodes,
  baseline,
  repoUrl,
  selectedKey,
  onSelect,
  artifacts,
  openArtifactId,
  onOpenArtifact,
  budgets,
  spend,
}: TaskRailProps) {
  const shown = [...artifacts]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .slice(0, ARTIFACT_LIMIT)

  return (
    <div className="space-y-7">
      <PipelineRail
        nodes={nodes}
        baseline={baseline}
        repoUrl={repoUrl}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />

      <section aria-label="Artifacts">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="micro-label text-muted">Artifacts</h2>
          <Link
            href={`/tasks/${taskId}/diff`}
            className="font-mono text-[0.62rem] text-muted hover:text-phosphor"
          >
            files changed →
          </Link>
        </div>

        {shown.length === 0 ? (
          <p className="mt-3 text-[0.72rem] text-muted">Nothing written yet.</p>
        ) : (
          <ul className="mt-2">
            {shown.map((artifact) => (
              <li key={artifact.id}>
                <button
                  type="button"
                  onClick={() => onOpenArtifact(artifact.id)}
                  aria-pressed={openArtifactId === artifact.id}
                  className={`flex w-full items-baseline justify-between gap-2 py-1 text-left transition-colors ${
                    openArtifactId === artifact.id ? 'text-phosphor' : 'text-muted hover:text-text'
                  }`}
                >
                  <span className="min-w-0 truncate text-[0.78rem]">
                    {artifact.path.split('/').at(-1)}
                  </span>
                  <span className="shrink-0 font-mono text-[0.6rem]">{artifact.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {artifacts.length > shown.length && (
          <Link
            href={`/tasks/${taskId}/artifacts`}
            className="mt-2 block font-mono text-[0.62rem] text-muted hover:text-phosphor"
          >
            all {artifacts.length} artifacts →
          </Link>
        )}
      </section>

      <BudgetPanel budgets={budgets} spend={spend} />
    </div>
  )
}
