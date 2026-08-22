import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'wouter'
import { ArtifactMarkdown } from '../components/artifact-markdown.tsx'
import { BudgetPanel } from '../components/budget-panel.tsx'
import { DecisionCard } from '../components/decision-card.tsx'
import { HarnessBadge } from '../components/harness-badge.tsx'
import { KickoffBrief } from '../components/kickoff-brief.tsx'
import { ModelBindingsPanel } from '../components/model-bindings-panel.tsx'
import { PlanBadge } from '../components/plan-badge.tsx'
import { ErrorState, LoadingState } from '../components/query-state.tsx'
import { StatusChip } from '../components/status-chip.tsx'
import { TaskLineage } from '../components/task-lineage.tsx'
import { TelemetryChart } from '../components/telemetry-chart.tsx'
import { mergeTimelineEvents, useTaskStream } from '../hooks/use-task-stream.ts'
import {
  answerDecision,
  approveGate,
  type ConversationMessage,
  type ConversationResponse,
  confirmConversationAction,
  createConversation,
  type DecisionItem,
  dismissDecision,
  getArtifact,
  getConversation,
  getTask,
  listArtifacts,
  listConversations,
  listDecisions,
  listEvents,
  listTasks,
  postConversationMessage,
  postFeedback,
  type ReworkInput,
  redirectGate,
  restartStage,
  reworkGate,
  type StopStageInput,
  stopStage,
  type TimelineEvent,
  type TimelineResponse,
} from '../lib/api-client.ts'
import { formatTimestamp } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'

interface TaskScreenProps {
  taskId: string
}

type InputMode = 'comment' | 'conversation'

export const EVENT_TITLES: Record<string, string> = {
  'task.created': 'Task launched',
  'task.transitioned': 'Task moved',
  'task.parked': 'Task parked',
  'task.failed': 'Task failed',
  'stage.started': 'Stage started',
  'stage.completed': 'Stage completed',
  'stage.failed': 'Stage failed',
  'gate.approved': 'Gate approved',
  'gate.redirected': 'Task redirected',
  'gate.reworked': 'Rework requested',
  'feedback.comment': 'Owner comment',
  'decision.raised': 'Decision raised',
  'decision.answered': 'Decision answered',
  'decision.dismissed': 'Decision dismissed',
  'decision.refused': 'Questions refused',
  'decision.inherited': 'Coverage gap inherited',
  'task.plan_recorded': 'Plan recorded',
  'task.profile_changed': 'Pipeline profile changed',
  'coverage_waiver.recorded': 'Coverage gap accepted',
}

function payloadValue(event: TimelineEvent, key: string): string | null {
  const value = event.payload[key]

  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Payload lists are what several events carry that matters most — the refused keys above all. */
function payloadList(event: TimelineEvent, key: string): string[] {
  const value = event.payload[key]
  if (!Array.isArray(value)) return []

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function payloadNumber(event: TimelineEvent, key: string): number | null {
  const value = event.payload[key]

  return typeof value === 'number' ? value : null
}

/** Human-facing verb per known tool name; an unrecognized tool falls back to its own name. */
const ACTIVITY_VERBS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Bash: 'Running',
  BashOutput: 'Checking',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Delegating to',
  TodoWrite: 'Updating plan',
}

/** REQ-915: a live `stage.activity` event reads as "Editing src/foo.ts", not raw tool/target keys. */
export function stageActivityLabel(event: TimelineEvent): string {
  const tool = payloadValue(event, 'tool') ?? 'Unknown tool'
  const target = payloadValue(event, 'target')
  const verb = ACTIVITY_VERBS[tool] ?? tool

  return target ? `${verb} ${target}` : verb
}

/**
 * REQ-915/AC-941: once an attempt's result is accepted — or it fails, or it's
 * interrupted — its activity is stale. Demoted here by dropping it from the
 * timeline rather than leaving it standing beside the outcome.
 */
export function visibleTimelineEvents(
  events: readonly TimelineEvent[],
  stages: readonly { id: string; status: string }[],
): TimelineEvent[] {
  const runningStageIds = new Set(
    stages.filter((stage) => stage.status === 'running').map((stage) => stage.id),
  )

  return events.filter(
    (event) => event.type !== 'stage.activity' || runningStageIds.has(event.stageId ?? ''),
  )
}

/** Mirrors the engine's own `countRedirects`, so the client reads the cap the same way the server enforces it. */
export function countGateRedirects(events: readonly TimelineEvent[], gateKey: string): number {
  return events.filter(
    (event) => event.type === 'gate.redirected' && payloadValue(event, 'gate') === gateKey,
  ).length
}

/**
 * decision.* events carry only the decision's id and identity, not its
 * question or answer text — that lives on the decision row itself, so the
 * timeline looks it up from the task's already-loaded decisions.
 */
export function eventDetail(
  event: TimelineEvent,
  decisionsById: Map<string, DecisionItem>,
): string {
  const decisionId = payloadValue(event, 'decisionId')
  const decision = decisionId ? decisionsById.get(decisionId) : undefined

  if (event.type === 'decision.raised') {
    return decision?.promptMd ?? payloadValue(event, 'key') ?? 'A decision was raised.'
  }
  if (event.type === 'decision.answered' || event.type === 'decision.dismissed') {
    const verb = event.type === 'decision.answered' ? 'Answered' : 'Dismissed'
    const actor = payloadValue(event, 'actor')
    const by = actor ? ` by ${actor}` : ''

    return decision?.answerMd ? `${verb}${by}: ${decision.answerMd}` : `${verb}${by}.`
  }

  // REQ-1208: a refused question is only refused out loud if its key is here.
  // The generic fallback below reads arrays as absent, which would render the
  // cap as an unexplained line and lose exactly what it was meant to name.
  if (event.type === 'decision.refused') {
    const keys = payloadList(event, 'keys')
    const cap = payloadNumber(event, 'cap')
    const limit = cap === null ? '' : ` (cap ${cap} per stage)`

    return keys.length > 0
      ? `Not asked${limit}: ${keys.join(', ')}`
      : `Questions past the cap were refused${limit}.`
  }

  if (event.type === 'task.plan_recorded') {
    const size = payloadValue(event, 'size') ?? 'unknown'
    const prerequisites = payloadList(event, 'prerequisites')
    const applied =
      event.payload.applied === false ? ' — profile already pinned, size not applied' : ''
    const proposes =
      prerequisites.length > 0 ? `; proposes ${prerequisites.join(', ')}` : '; no prerequisites'

    return `Planning declared size ${size}${proposes}${applied}.`
  }

  if (event.type === 'task.profile_changed') {
    const from = payloadValue(event, 'from') ?? 'the pinned profile'
    const to = payloadValue(event, 'to') ?? 'a new profile'
    const size = payloadValue(event, 'size')

    return size
      ? `Declared size ${size} switched the pipeline from ${from} to ${to}.`
      : `Pipeline switched from ${from} to ${to}.`
  }

  if (event.type === 'coverage_waiver.recorded') {
    const repoUrl = payloadValue(event, 'repoUrl')

    return repoUrl
      ? `The coverage gap was accepted for ${repoUrl}. Later tasks against it inherit this until a probe finds it adequate, or it is revoked in Settings.`
      : 'The coverage gap was accepted for this repository.'
  }

  if (event.type === 'decision.inherited') {
    const originTaskId = payloadValue(event, 'originTaskId')

    return originTaskId
      ? `This repository's coverage gap was already accepted on task ${originTaskId.slice(0, 8)}; the task was not asked again.`
      : "This repository's coverage gap was already accepted; the task was not asked again."
  }

  return (
    payloadValue(event, 'comment') ??
    payloadValue(event, 'reason') ??
    payloadValue(event, 'detail') ??
    payloadValue(event, 'title') ??
    payloadValue(event, 'to') ??
    'State recorded in the task ledger.'
  )
}

function connectionClasses(connection: string): string {
  if (connection === 'live') return 'bg-status-active text-status-active'
  if (connection === 'connecting') return 'bg-amber text-amber'

  return 'bg-danger text-danger'
}

function mergeEventResponses(
  previous: TimelineResponse | undefined,
  current: TimelineResponse,
): TimelineResponse {
  let merged = previous?.events ?? []
  for (const event of current.events) {
    merged = mergeTimelineEvents(merged, event)
  }

  return { events: merged }
}

export function ConversationMessageItem({ message }: { message: ConversationMessage }) {
  const isPending = message.status === 'queued' || message.status === 'responding'

  return (
    <li
      className={`grid gap-2 border-l-2 border-cyan/55 bg-cyan/5 px-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] ${
        isPending ? 'attention-pulse' : ''
      }`}
      data-timeline-kind="conversation-message"
    >
      <div className="font-mono text-[0.68rem] leading-5 text-muted">
        <p>#{message.sequence}</p>
        <time dateTime={String(message.createdAt)}>{formatTimestamp(message.createdAt)}</time>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-cyan">
            {message.role === 'owner' ? 'Owner' : message.role === 'assistant' ? 'Guide' : 'System'}
          </h3>
          <span className="border border-cyan/30 px-1.5 py-0.5 font-mono text-[0.64rem] text-cyan">
            {message.taskState.replaceAll('_', ' ')}
          </span>
        </div>
        {message.contentMd && (
          <div className="artifact-document mt-2 text-sm">
            <ArtifactMarkdown content={message.contentMd} />
          </div>
        )}
        {isPending && (
          <p className="mt-3 flex items-center gap-2 font-mono text-xs text-amber" role="status">
            <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
            {message.status === 'responding' ? 'Responding…' : 'Waiting for a response slot…'}
          </p>
        )}
        {message.status === 'failed' && (
          <p className="mt-3 border-t border-danger/30 pt-3 text-sm text-danger">
            Response failed: {message.failureReason ?? 'no reason was recorded'}
          </p>
        )}
      </div>
    </li>
  )
}

export function TaskScreen({ taskId }: TaskScreenProps) {
  const queryClient = useQueryClient()
  const detail = useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: ({ signal }) => getTask(taskId, signal),
  })
  const timeline = useQuery({
    queryKey: queryKeys.events(taskId),
    queryFn: ({ signal }) => listEvents(taskId, signal),
    structuralSharing: (previous, current) =>
      mergeEventResponses(previous as TimelineResponse | undefined, current as TimelineResponse),
  })
  const conversations = useQuery({
    queryKey: queryKeys.conversations(taskId),
    queryFn: () => listConversations(taskId),
  })
  const decisions = useQuery({
    queryKey: queryKeys.decisions(taskId),
    queryFn: () => listDecisions(taskId),
  })
  // Shared with the navigation's own list under the same key: the lineage
  // needs titles for a handful of ids, not a fetch per id.
  const tasks = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: ({ signal }) => listTasks(signal),
  })
  // The brief is read at the kickoff gate only — fetching it elsewhere would
  // be a document no gate is asking the owner to act on.
  const atKickoffGate = detail.data?.task.status === 'human_kickoff_gate'
  const artifacts = useQuery({
    queryKey: queryKeys.artifacts(taskId),
    queryFn: ({ signal }) => listArtifacts(taskId, signal),
    enabled: atKickoffGate,
  })
  const briefArtifactId = artifacts.data?.artifacts.find((a) => a.kind === 'proposal')?.id
  const brief = useQuery({
    queryKey: queryKeys.artifact(taskId, briefArtifactId ?? 'none'),
    queryFn: ({ signal }) => getArtifact(taskId, briefArtifactId ?? '', signal),
    enabled: atKickoffGate && Boolean(briefArtifactId),
  })
  // Tracks a conversation created by this session the instant its id is
  // known, so the very first message doesn't wait on a list refetch to
  // remount the conversation query on the right key (see converse.onSuccess).
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined)
  const conversationId = activeConversationId ?? conversations.data?.conversations[0]?.id
  const conversation = useQuery({
    queryKey: queryKeys.conversation(taskId, conversationId ?? 'none'),
    queryFn: () => getConversation(taskId, conversationId ?? ''),
    enabled: Boolean(conversationId),
  })
  const connection = useTaskStream(taskId)
  const [inputMode, setInputMode] = useState<InputMode>('comment')
  const [comment, setComment] = useState('')
  const [stageId, setStageId] = useState('')
  const [gateComment, setGateComment] = useState('')
  const [reworkTarget, setReworkTarget] = useState<ReworkInput['target'] | ''>('')
  const [restartGuidance, setRestartGuidance] = useState('')
  // answerOption, answerText, and dismiss are one mutation instance each,
  // shared by every open decision on this task — react-query's own
  // isPending/variables/error reflect only the most recently dispatched
  // call, so per-decision busy/error state is tracked here instead, fed by
  // each mutation's per-invocation onMutate/onSuccess/onError callbacks.
  const [decisionActivity, setDecisionActivity] = useState<
    Record<string, { pending: boolean; error?: string }>
  >({})

  function markDecisionPending(decisionId: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: true } }))
  }
  function markDecisionSettled(decisionId: string, error?: string): void {
    setDecisionActivity((prev) => ({ ...prev, [decisionId]: { pending: false, error } }))
  }

  async function refreshTask(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      queryClient.invalidateQueries({ queryKey: queryKeys.events(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(taskId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.decisions(taskId) }),
    ])
  }

  const approve = useMutation({ mutationFn: () => approveGate(taskId), onSuccess: refreshTask })
  const redirect = useMutation({
    mutationFn: () => redirectGate(taskId, { comment: gateComment.trim() }),
    onSuccess: async () => {
      setGateComment('')
      setReworkTarget('')
      await refreshTask()
    },
  })
  const rework = useMutation({
    mutationFn: () => {
      if (!reworkTarget) throw new Error('Choose a rework target')

      return reworkGate(taskId, { target: reworkTarget, comment: gateComment.trim() })
    },
    onSuccess: async () => {
      setGateComment('')
      await refreshTask()
    },
  })
  const feedback = useMutation({
    mutationFn: () =>
      postFeedback(taskId, {
        comment: comment.trim(),
        ...(stageId ? { stageId } : {}),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<TimelineResponse>(queryKeys.events(taskId), (current) => ({
        events: mergeTimelineEvents(current?.events ?? [], result.event),
      }))
      setComment('')
      setStageId('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
    },
  })
  const converse = useMutation({
    mutationFn: async () => {
      const activeId = conversationId ?? (await createConversation(taskId)).conversation.id

      return {
        conversationId: activeId,
        result: await postConversationMessage(taskId, activeId, { message: comment.trim() }),
      }
    },
    onSuccess: ({ conversationId: activeId, result }) => {
      setActiveConversationId(activeId)
      queryClient.setQueryData<ConversationResponse>(
        queryKeys.conversation(taskId, activeId),
        (current) => ({
          conversation: current?.conversation ?? {
            id: activeId,
            taskId,
            subjectKind: null,
            subjectId: null,
            status: 'open',
            lastSequence: result.response.sequence,
            contextCommit: null,
            contextTaskState: null,
            summaryMd: null,
            summaryThrough: 0,
            providerSession: null,
            createdAt: result.message.createdAt,
            updatedAt: result.message.createdAt,
          },
          messages: [...(current?.messages ?? []), result.message, result.response],
          actions: current?.actions ?? [],
        }),
      )
      setComment('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(taskId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.attention })
    },
  })
  const confirmAction = useMutation({
    mutationFn: (actionId: string) =>
      confirmConversationAction(taskId, conversationId ?? '', actionId),
    onSuccess: refreshTask,
  })
  const answerOption = useMutation({
    mutationFn: ({
      decisionId,
      optionId,
      value,
    }: {
      decisionId: string
      optionId: string
      value?: string
    }) => answerDecision(decisionId, value ? { optionId, text: value } : { optionId }),
    onMutate: ({ decisionId }) => markDecisionPending(decisionId),
    onSuccess: async (_data, { decisionId }) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, { decisionId }) => markDecisionSettled(decisionId, error.message),
  })
  const answerText = useMutation({
    mutationFn: ({ decisionId, text }: { decisionId: string; text: string }) =>
      answerDecision(decisionId, { text }),
    onMutate: ({ decisionId }) => markDecisionPending(decisionId),
    onSuccess: async (_data, { decisionId }) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, { decisionId }) => markDecisionSettled(decisionId, error.message),
  })
  const dismiss = useMutation({
    mutationFn: (decisionId: string) => dismissDecision(decisionId, {}),
    onMutate: (decisionId) => markDecisionPending(decisionId),
    onSuccess: async (_data, decisionId) => {
      markDecisionSettled(decisionId)
      await refreshTask()
    },
    onError: (error, decisionId) => markDecisionSettled(decisionId, error.message),
  })
  const stageRows = detail.data?.stages ?? []
  // The API orders stages by (nodeKey, attempt), not chronologically, so a
  // task that was interrupted at more than one node over its lifetime needs
  // an explicit recency sort here — reversing the API order would pick
  // whichever nodeKey sorts alphabetically last, not the most recent attempt.
  const stagesByRecency = [...stageRows].sort((a, b) => {
    const aStart = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bStart = b.startedAt ? new Date(b.startedAt).getTime() : 0

    return bStart - aStart
  })
  const runningStage = stagesByRecency.find((stage) => stage.status === 'running')
  const interruptedAttempt = stagesByRecency.find((stage) => stage.status === 'interrupted')
  const interruptedStage =
    interruptedAttempt?.interruptionCleanupStatus === 'succeeded' ? interruptedAttempt : undefined
  const stop = useMutation({
    mutationFn: () => {
      if (!runningStage) throw new Error('No running stage')

      return stopStage(taskId, {
        stageId: runningStage.id,
        graphId: runningStage.graphId,
        nodeKey: runningStage.nodeKey as StopStageInput['nodeKey'],
        attempt: runningStage.attempt,
      })
    },
    onSuccess: refreshTask,
  })
  const restart = useMutation({
    mutationFn: () => {
      if (!interruptedStage) throw new Error('No safely cleaned interrupted stage')

      return restartStage(taskId, {
        stageId: interruptedStage.id,
        guidance: restartGuidance.trim() || undefined,
        idempotencyKey: `restart:${interruptedStage.id}:${restartGuidance.trim()}`,
      })
    },
    onSuccess: async () => {
      setRestartGuidance('')
      await refreshTask()
    },
  })

  if (detail.isPending || timeline.isPending || conversations.isPending || decisions.isPending) {
    return <LoadingState title="Loading task channel…" />
  }
  if (detail.isError) {
    return <ErrorState title="Task unavailable" detail={detail.error.message} />
  }
  if (timeline.isError) {
    return <ErrorState title="Timeline unavailable" detail={timeline.error.message} />
  }
  if (decisions.isError) {
    return <ErrorState title="Decisions unavailable" detail={decisions.error.message} />
  }
  if (conversations.isError || conversation.isError) {
    return (
      <ErrorState
        title="Conversation unavailable"
        detail={(conversations.error ?? conversation.error)?.message ?? 'Unknown error'}
      />
    )
  }

  const currentGate = detail.data.graph?.dag.nodes.find(
    (node) => node.kind === 'gate' && node.key === detail.data.task.status,
  )
  const reworkTargets = currentGate?.kind === 'gate' ? (currentGate.rework ?? []) : []
  const gateError = approve.error ?? redirect.error ?? rework.error
  const gateBusy = approve.isPending || redirect.isPending || rework.isPending
  // REQ-1305: computed the same way the server counts it, so the redirect
  // control reads as unavailable before a redirect attempt ever round-trips.
  const redirectCap =
    currentGate?.kind === 'gate' && currentGate.redirect
      ? { key: currentGate.redirect.cap, limit: detail.data.task.caps[currentGate.redirect.cap] }
      : undefined
  const redirectsUsed =
    currentGate?.kind === 'gate' ? countGateRedirects(timeline.data.events, currentGate.key) : 0
  const redirectCapSpent = redirectCap ? redirectsUsed >= redirectCap.limit : false
  const items = visibleTimelineEvents(timeline.data.events, stageRows)
  const messages = conversation.data?.messages ?? []
  const actions = conversation.data?.actions ?? []
  const decisionRows = decisions.data.decisions
  const decisionsById = new Map(decisionRows.map((decision) => [decision.id, decision]))

  function decisionBusy(decisionId: string): boolean {
    return decisionActivity[decisionId]?.pending ?? false
  }

  function decisionError(decisionId: string): string | undefined {
    return decisionActivity[decisionId]?.error
  }

  function discussDecision(decisionConversationId: string | null): void {
    if (decisionConversationId) setActiveConversationId(decisionConversationId)
  }

  function submitInput(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!comment.trim()) return
    if (inputMode === 'conversation') {
      converse.mutate()
    } else {
      feedback.mutate()
    }
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status={detail.data.task.status} />
              <HarnessBadge status={detail.data.task.harnessStatus} />
              <PlanBadge size={detail.data.task.planSize} />
              <span className="font-mono text-xs text-muted">{detail.data.task.slug}</span>
            </div>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">
              {detail.data.task.title}
            </h1>
            <p className="mt-3 break-all font-mono text-xs leading-6 text-muted">
              {detail.data.task.repoUrl} · {detail.data.task.baseBranch}
            </p>
            <TaskLineage
              originTaskId={detail.data.task.originTaskId}
              blockedBy={detail.data.task.blockedBy}
              tasks={tasks.data?.tasks}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/tasks/${taskId}/artifacts`} className="button-secondary">
              Read artifacts
            </Link>
            <Link href={`/tasks/${taskId}/diff`} className="button-secondary">
              Files changed
            </Link>
            <span className="flex items-center gap-2 border border-border px-3 py-2 font-mono text-xs text-muted">
              <span
                className={`h-2 w-2 rounded-full ${connectionClasses(connection)}`}
                aria-hidden="true"
              />
              stream {connection}
            </span>
          </div>
        </div>
      </header>

      {currentGate?.kind === 'gate' && (
        <section className="panel attention-pulse border-amber/45 p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <p className="micro-label text-amber">Human gate</p>
              <h2 className="mt-2 text-lg font-semibold">{currentGate.key.replaceAll('_', ' ')}</h2>
            </div>
            <button
              type="button"
              className="button-primary"
              onClick={() => approve.mutate()}
              disabled={gateBusy}
            >
              Approve → {currentGate.approve.replaceAll('_', ' ')}
            </button>
          </div>

          {atKickoffGate && (
            <div className="mt-5 border-t border-border pt-5">
              {artifacts.isError && (
                <p className="field-error">Brief unavailable: {artifacts.error.message}</p>
              )}
              {!artifacts.isError && brief.isPending && (
                <p className="font-mono text-xs text-muted">Loading the kickoff brief…</p>
              )}
              {brief.isError && (
                <p className="field-error">Brief unavailable: {brief.error.message}</p>
              )}
              {brief.data && <KickoffBrief content={brief.data.artifact.content ?? ''} />}
            </div>
          )}

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              className="control min-h-24 w-full resize-y"
              value={gateComment}
              onChange={(event) => setGateComment(event.currentTarget.value)}
              placeholder="Required context for redirect or rework…"
              aria-label="Gate comment"
            />
            <div className="flex min-w-48 flex-col gap-2">
              {currentGate.redirect &&
                redirectCap &&
                (redirectCapSpent ? (
                  <p
                    className="border border-border px-3 py-2 font-mono text-xs text-muted"
                    role="status"
                  >
                    Redirect unavailable: {redirectsUsed} of {redirectCap.limit}{' '}
                    {redirectCap.key.replaceAll('_', ' ')} used.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="button-secondary border-amber/45 text-amber"
                    disabled={!gateComment.trim() || gateBusy}
                    onClick={() => redirect.mutate()}
                  >
                    Redirect
                  </button>
                ))}
              {reworkTargets.length > 0 && (
                <>
                  <select
                    className="control w-full"
                    value={reworkTarget}
                    onChange={(event) =>
                      setReworkTarget(event.currentTarget.value as ReworkInput['target'])
                    }
                    aria-label="Rework target"
                  >
                    <option value="">Rework target…</option>
                    {reworkTargets.map((target) => (
                      <option key={target} value={target}>
                        {target.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-danger"
                    disabled={!gateComment.trim() || !reworkTarget || gateBusy}
                    onClick={() => rework.mutate()}
                  >
                    Request rework
                  </button>
                </>
              )}
            </div>
          </div>
          {gateError && <p className="field-error mt-3">{gateError.message}</p>}
        </section>
      )}

      {decisionRows.length > 0 && (
        <section aria-label="Decisions">
          <ol className="grid gap-4">
            {decisionRows.map((decision) => {
              const parkedOnThis =
                decision.status === 'open' &&
                decision.blocking &&
                (detail.data.task.status === 'waiting_human' ||
                  detail.data.task.status === 'paused')

              return (
                <DecisionCard
                  key={decision.id}
                  decision={decision}
                  parkedOnThis={parkedOnThis}
                  busy={decisionBusy(decision.id)}
                  error={decisionError(decision.id)}
                  onAnswerOption={(optionId, value) =>
                    answerOption.mutate({ decisionId: decision.id, optionId, value })
                  }
                  onAnswerText={(text) => answerText.mutate({ decisionId: decision.id, text })}
                  onDismiss={() => dismiss.mutate(decision.id)}
                  onDiscuss={
                    decision.conversationId
                      ? () => discussDecision(decision.conversationId)
                      : undefined
                  }
                />
              )
            })}
          </ol>
        </section>
      )}

      {runningStage && (
        <section className="panel border-danger/45 p-4 sm:p-5">
          <p className="micro-label text-danger">Running stage</p>
          <h2 className="mt-2 text-lg font-semibold">
            {runningStage.nodeKey} · attempt {runningStage.attempt}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Stopping may still incur provider cost. All uncommitted work from this attempt will be
            discarded; accepted commits remain intact.
          </p>
          <button
            type="button"
            className="button-danger mt-4"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? 'Stopping and cleaning…' : 'Stop current run'}
          </button>
          {stop.error && <p className="field-error mt-3">{stop.error.message}</p>}
        </section>
      )}

      {detail.data.task.status === 'paused' &&
        interruptedAttempt &&
        interruptedAttempt?.interruptionCleanupStatus !== 'succeeded' && (
          <section className="panel border-amber/45 p-4 sm:p-5" aria-live="polite">
            <p className="micro-label text-amber">
              {interruptedAttempt?.interruptionCleanupStatus === 'failed'
                ? 'Cleanup needs attention'
                : 'Stopping current run'}
            </p>
            <h2 className="mt-2 text-lg font-semibold">
              {interruptedAttempt?.nodeKey} · attempt {interruptedAttempt?.attempt}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {interruptedAttempt?.interruptionCleanupStatus === 'failed'
                ? `The task remains paused and cannot restart: ${interruptedAttempt.interruptionFailure ?? 'cleanup failed'}`
                : 'The exact execution is being terminated and its uncommitted work is being discarded. Restart becomes available only after cleanup succeeds.'}
            </p>
          </section>
        )}

      {detail.data.task.status === 'paused' && interruptedStage && (
        <section className="panel border-amber/45 p-4 sm:p-5">
          <p className="micro-label text-amber">Restart interrupted stage</p>
          <h2 className="mt-2 text-lg font-semibold">
            {interruptedStage.nodeKey} · replacement for attempt {interruptedStage.attempt}
          </h2>
          <p className="mt-2 text-sm text-muted">
            Cleanup succeeded. The replacement starts from the last accepted commit and receives
            only the exact guidance below.
          </p>
          <textarea
            className="control mt-4 min-h-24 w-full resize-y"
            value={restartGuidance}
            onChange={(event) => setRestartGuidance(event.currentTarget.value)}
            placeholder="Optional guidance for the replacement attempt…"
            aria-label="Restart guidance"
          />
          <button
            type="button"
            className="button-primary mt-3"
            disabled={restart.isPending}
            onClick={() => restart.mutate()}
          >
            {restart.isPending ? 'Restarting…' : 'Confirm restart'}
          </button>
          {restart.error && <p className="field-error mt-3">{restart.error.message}</p>}
        </section>
      )}

      <BudgetPanel budgets={detail.data.task.budgets} spend={detail.data.spend} />
      <ModelBindingsPanel modelBindings={detail.data.task.modelBindings} />

      {detail.data.graph && (
        <section className="panel p-4 sm:p-5">
          <p className="micro-label text-phosphor">Pinned pipeline</p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {detail.data.graph.dag.nodes.map((node) => {
              const latest = [...detail.data.stages]
                .reverse()
                .find((stage) => stage.nodeKey === node.key)
              const isCurrent =
                detail.data.task.status === node.key || detail.data.task.resumeStatus === node.key

              return (
                <li
                  key={node.key}
                  className={`border p-3 ${isCurrent ? 'border-cyan bg-cyan/5' : 'border-border'}`}
                >
                  <p className="font-mono text-xs text-cyan">{node.key}</p>
                  <p className="mt-1 text-xs text-muted">
                    {latest ? `${latest.status} · attempt ${latest.attempt}` : 'not started'}
                  </p>
                  {latest?.acceptedCommit && (
                    <p className="mt-1 truncate font-mono text-[0.68rem] text-muted">
                      accepted {latest.acceptedCommit}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(28rem,0.9fr)]">
        <section className="panel min-w-0 p-4 sm:p-5">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <p className="micro-label text-phosphor">Live ledger</p>
              <h2 className="mt-2 text-lg font-semibold">Timeline</h2>
            </div>
            <span className="font-mono text-xs text-muted">{items.length} entries</span>
          </div>

          {connection === 'stale' && (
            <p className="mt-4 border border-danger/35 bg-danger/10 p-3 text-sm text-danger">
              Live connection is stale. Reconnecting from the last event cursor.
            </p>
          )}

          <ol className="mt-2 divide-y divide-border">
            {items.map((event) => {
              if (event.type === 'stage.activity') {
                return (
                  <li
                    key={`event-${event.seq}`}
                    className="attention-pulse grid gap-2 border-l-2 border-amber/55 bg-amber/5 px-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]"
                    data-timeline-kind="stage-activity"
                  >
                    <div className="font-mono text-[0.68rem] leading-5 text-muted">
                      <p>#{event.seq}</p>
                      <time dateTime={String(event.createdAt)}>
                        {formatTimestamp(event.createdAt)}
                      </time>
                    </div>
                    <p
                      className="flex items-center gap-2 font-mono text-xs text-amber"
                      role="status"
                    >
                      <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
                      {stageActivityLabel(event)}
                    </p>
                  </li>
                )
              }

              const stage = payloadValue(event, 'nodeKey') ?? payloadValue(event, 'stage')

              return (
                <li
                  key={`event-${event.seq}`}
                  className="grid gap-2 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]"
                >
                  <div className="font-mono text-[0.68rem] leading-5 text-muted">
                    <p>#{event.seq}</p>
                    <time dateTime={String(event.createdAt)}>
                      {formatTimestamp(event.createdAt)}
                    </time>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{EVENT_TITLES[event.type] ?? event.type}</h3>
                      {stage && (
                        <span className="border border-cyan/30 px-1.5 py-0.5 font-mono text-[0.64rem] text-cyan">
                          {stage}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                      {eventDetail(event, decisionsById)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted">No timeline entries yet.</p>
          )}
        </section>

        <TelemetryChart stages={detail.data.stages} messages={messages} />
      </div>

      <section className="panel min-w-0 p-4 sm:p-5">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="micro-label text-cyan">Task conversation</p>
            <h2 className="mt-2 text-lg font-semibold">Guide</h2>
          </div>
          <span className="font-mono text-xs text-muted">{messages.length} messages</span>
        </div>
        <ol className="mt-2 divide-y divide-border">
          {messages.map((message) => (
            <ConversationMessageItem key={message.id} message={message} />
          ))}
        </ol>
        {actions.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="micro-label text-amber">Proposed actions</p>
            <ul className="mt-3 space-y-3">
              {actions.map((action) => (
                <li key={action.id} className="border border-amber/35 bg-amber/5 p-3">
                  <p className="font-mono text-xs text-amber">{action.kind}</p>
                  <p className="mt-2 break-words text-sm">
                    {action.instruction ?? 'No instruction'}
                  </p>
                  <pre className="mt-2 overflow-x-auto text-[0.68rem] text-muted">
                    {JSON.stringify(action.target, null, 2)}
                  </pre>
                  {action.status === 'proposed' ? (
                    <button
                      type="button"
                      className="button-secondary mt-3"
                      disabled={confirmAction.isPending}
                      onClick={() => confirmAction.mutate(action.id)}
                    >
                      Confirm action
                    </button>
                  ) : (
                    <p className="mt-3 font-mono text-xs text-muted">{action.status}</p>
                  )}
                </li>
              ))}
            </ul>
            {confirmAction.error && (
              <p className="field-error mt-3">{confirmAction.error.message}</p>
            )}
          </div>
        )}
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Start a conversation to discuss the task without changing it.
          </p>
        )}
      </section>

      <form className="panel sticky bottom-3 z-10 p-4 sm:p-5" onSubmit={submitInput}>
        <fieldset className="mb-3 grid grid-cols-2 border border-border-bright bg-ground p-1">
          <legend className="sr-only">Input mode</legend>
          {(['comment', 'conversation'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`min-h-10 px-3 font-mono text-xs font-bold uppercase tracking-wider ${
                inputMode === mode
                  ? 'bg-phosphor text-ground'
                  : 'bg-elevated text-muted hover:text-text'
              }`}
              aria-pressed={inputMode === mode}
              onClick={() => {
                setInputMode(mode)
                if (mode === 'conversation') setStageId('')
              }}
            >
              {mode}
            </button>
          ))}
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row">
          <textarea
            className="control min-h-24 min-w-0 flex-1 resize-y"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            placeholder={
              inputMode === 'conversation'
                ? 'Continue the task conversation…'
                : 'Comment on the task while it runs…'
            }
            aria-label={inputMode === 'conversation' ? 'Conversation message' : 'Task comment'}
          />
          <div className="flex flex-col gap-2 sm:w-56">
            {inputMode === 'comment' && (
              <select
                className="control w-full"
                value={stageId}
                onChange={(event) => setStageId(event.currentTarget.value)}
                aria-label="Pin comment to stage"
              >
                <option value="">Whole task</option>
                {detail.data.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.nodeKey} #{stage.attempt}
                  </option>
                ))}
              </select>
            )}
            <button
              className="button-primary w-full"
              type="submit"
              disabled={!comment.trim() || feedback.isPending || converse.isPending}
            >
              {inputMode === 'conversation'
                ? converse.isPending
                  ? 'Sending…'
                  : 'Send message'
                : feedback.isPending
                  ? 'Posting…'
                  : 'Post comment'}
            </button>
          </div>
        </div>
        {(feedback.error ?? converse.error) && (
          <p className="field-error mt-3">{(feedback.error ?? converse.error)?.message}</p>
        )}
      </form>
    </div>
  )
}
