import type { FormEvent, KeyboardEvent } from 'react'
import type { TaskDetail } from '../lib/api-client.ts'
import { nodeLabel } from '../lib/task-thread.ts'

type Stage = TaskDetail['stages'][number]

export type ComposerMode = 'comment' | 'conversation'

const MODES: { readonly id: ComposerMode; readonly label: string; readonly hint: string }[] = [
  { id: 'comment', label: 'Comment', hint: 'Note it on the record. Nothing runs.' },
  { id: 'conversation', label: 'Ask guide', hint: 'Ask about the task. Costs a model call.' },
]

interface TaskComposerProps {
  readonly mode: ComposerMode
  readonly onModeChange: (mode: ComposerMode) => void
  readonly value: string
  readonly onChange: (value: string) => void
  readonly stageId: string
  readonly onStageIdChange: (stageId: string) => void
  readonly stages: readonly Stage[]
  readonly busy: boolean
  readonly error?: string
  readonly onSubmit: () => void
}

export function TaskComposer({
  mode,
  onModeChange,
  value,
  onChange,
  stageId,
  onStageIdChange,
  stages,
  busy,
  error,
  onSubmit,
}: TaskComposerProps) {
  const active = MODES.find((entry) => entry.id === mode) ?? MODES[0]

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (value.trim()) onSubmit()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && value.trim()) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <form className="border border-border bg-surface" onSubmit={submit}>
      <textarea
        className="min-h-16 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted/70"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder={active?.hint}
        aria-label={mode === 'conversation' ? 'Conversation message' : 'Task comment'}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Input mode</legend>
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={mode === entry.id}
              onClick={() => {
                onModeChange(entry.id)
                if (entry.id === 'conversation') onStageIdChange('')
              }}
              className={`px-2 py-1 font-mono text-[0.68rem] uppercase tracking-widest transition-colors ${
                mode === entry.id
                  ? 'text-phosphor underline decoration-phosphor underline-offset-4'
                  : 'text-muted hover:text-text'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>

        {mode === 'comment' && stages.length > 0 && (
          <select
            className="control min-h-9 max-w-44 border-border bg-transparent py-1 font-mono text-[0.7rem]"
            value={stageId}
            onChange={(event) => onStageIdChange(event.currentTarget.value)}
            aria-label="Pin comment to stage"
          >
            <option value="">whole task</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {nodeLabel(stage.nodeKey).toLowerCase()}
                {stage.attempt > 0 ? ` · run ${stage.attempt + 1}` : ''}
              </option>
            ))}
          </select>
        )}

        <button
          className="button-primary ml-auto min-h-9 py-1"
          type="submit"
          disabled={!value.trim() || busy}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>

      {error && <p className="field-error px-3 pb-2">{error}</p>}
    </form>
  )
}
