import {
  BarSeries,
  ChartContainer,
  createTheme,
  Legend,
  LineSeries,
  Tooltip,
  YAxis,
} from '@wick-charts/react'
import { useEffect, useState } from 'react'
import type { ConversationMessage, TaskDetail } from '../lib/api-client.ts'
import { MicroLabel } from '../ui/index.ts'

type Stage = TaskDetail['stages'][number]
type ChartTheme = ReturnType<typeof createTheme>['theme']

export interface TelemetryAttempt {
  readonly id: string
  readonly kind: 'stage' | 'conversation'
  readonly label: string
  readonly provider: string
  readonly model: string | null
  readonly startedAt: string | Date | null
  readonly finishedAt: string | Date | null
  readonly durationMs: number | null
  readonly tokens: Readonly<Record<string, number>> | null
  readonly costUsd: number | null
  readonly sortAt: number
  readonly sequence: number
}

const CHART_START = Date.UTC(2026, 0, 1)
const CHART_STEP_MS = 60_000

/**
 * The canvas paints itself from the page's own palette, so a theme change moves
 * both together. It watches the document rather than the theme context: the
 * attribute is the truth either way, and the chart stays renderable anywhere.
 */
function useMissionControlChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(null)

  useEffect(() => {
    const root = document.documentElement

    function readPalette(): void {
      const styles = getComputedStyle(root)
      const token = (name: string) => styles.getPropertyValue(name).trim()
      setTheme(
        createTheme({
          name: 'SpecMate mission control',
          background: token('--color-card'),
          chartGradient: [token('--color-popover'), token('--color-card')],
          typography: {
            fontFamily: token('--font-mono'),
            fontSize: 11,
            axisFontSize: 10,
            yFontSize: 10,
            tooltipFontSize: 11,
          },
          grid: { color: token('--color-border'), style: 'dashed' },
          line: {
            color: token('--color-info'),
            areaTopColor: token('--color-info'),
            areaBottomColor: token('--color-card'),
          },
          seriesColors: [
            token('--color-primary'),
            token('--color-warning'),
            token('--color-info'),
            token('--color-success'),
          ],
          crosshair: {
            color: token('--color-primary'),
            labelBackground: token('--color-popover'),
            labelTextColor: token('--color-foreground'),
          },
          axis: { textColor: token('--color-muted-foreground') },
          tooltip: {
            background: token('--color-popover'),
            textColor: token('--color-foreground'),
            borderColor: token('--color-border-strong'),
          },
          fontUrl: null,
        }).theme,
      )
    }

    readPalette()

    // The canvas draws its own text, so it has to be told again once the
    // theme's face has arrived — otherwise the chart keeps the fallback the
    // page had for the first few hundred milliseconds.
    document.fonts?.ready.then(readPalette)

    const observer = new MutationObserver(readPalette)
    observer.observe(root, { attributeFilter: ['data-theme'] })

    return () => observer.disconnect()
  }, [])

  return theme
}

function timestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null

  const parsed = new Date(value).getTime()

  return Number.isFinite(parsed) ? parsed : null
}

function durationSeconds(attempt: TelemetryAttempt): number | null {
  if (attempt.durationMs !== null) return Math.max(0, attempt.durationMs / 1_000)

  const started = timestamp(attempt.startedAt)
  const finished = timestamp(attempt.finishedAt)
  if (started === null || finished === null) {
    return null
  }

  return Math.max(0, (finished - started) / 1_000)
}

export function buildTelemetryAttempts(
  stages: Stage[],
  messages: ConversationMessage[],
): TelemetryAttempt[] {
  const attempts: TelemetryAttempt[] = []
  let sequence = 0
  for (const stage of stages) {
    // Gated on telemetry alone, not startedAt: a stage that has started but
    // has no telemetry yet (running, or finished without ever recording any)
    // belongs only in the caller's `absent` list — including it here too
    // would show the same attempt in both the chart and the "no telemetry"
    // footer at once.
    if (!stage.telemetry) continue
    attempts.push({
      id: `stage:${stage.id}`,
      kind: 'stage',
      // Attempts are stored 0-based; every label a human reads counts from one.
      label: `${stage.nodeKey} / attempt ${stage.attempt + 1}`,
      provider: stage.provider,
      model: stage.telemetry.model ?? null,
      startedAt: stage.telemetry.startedAt ?? stage.startedAt,
      finishedAt: stage.telemetry.finishedAt ?? stage.finishedAt,
      durationMs: null,
      tokens: stage.telemetry.tokens ?? null,
      costUsd: stage.telemetry.costUsd ?? null,
      sortAt:
        timestamp(stage.telemetry.startedAt ?? stage.startedAt) ??
        timestamp(stage.createdAt) ??
        Number.MAX_SAFE_INTEGER,
      sequence,
    })
    sequence += 1
  }
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const [attempt, telemetry] of message.telemetry.entries()) {
      attempts.push({
        id: `conversation:${message.id}:${attempt}`,
        kind: 'conversation',
        label: `Conversation / attempt ${attempt + 1}`,
        provider: telemetry.provider ?? 'answerer',
        model: telemetry.model ?? null,
        startedAt: telemetry.startedAt ?? null,
        finishedAt: telemetry.finishedAt ?? null,
        durationMs: telemetry.durationMs ?? null,
        tokens: telemetry.tokens ?? null,
        costUsd: telemetry.costUsd ?? null,
        sortAt:
          timestamp(telemetry.startedAt) ?? timestamp(message.createdAt) ?? Number.MAX_SAFE_INTEGER,
        sequence,
      })
      sequence += 1
    }
  }

  return attempts.sort(
    (left, right) => left.sortAt - right.sortAt || left.sequence - right.sequence,
  )
}

export function TelemetryChart({
  stages,
  messages,
}: {
  stages: Stage[]
  messages: ConversationMessage[]
}) {
  const theme = useMissionControlChartTheme()
  const recorded = buildTelemetryAttempts(stages, messages)
  const absent = stages.filter((stage) => stage.telemetry === null)
  const tokenKinds = [...new Set(recorded.flatMap((attempt) => Object.keys(attempt.tokens ?? {})))]
  const colors = theme?.seriesColors ?? []
  const tokenLayers = tokenKinds.map((kind) =>
    recorded.map((attempt, index) => ({
      time: CHART_START + index * CHART_STEP_MS,
      value: attempt.tokens?.[kind] ?? 0,
    })),
  )
  const durations = recorded.flatMap((attempt, index) => {
    const duration = durationSeconds(attempt)

    return duration === null ? [] : [{ time: CHART_START + index * CHART_STEP_MS, value: duration }]
  })
  const hasChartData = tokenLayers.length > 0 || durations.length > 0
  const recordedCost = recorded.reduce(
    (total, attempt) => total + (attempt.costUsd === null ? 0 : attempt.costUsd),
    0,
  )
  const absentCostCount = recorded.filter((attempt) => attempt.costUsd === null).length

  return (
    <section className="border-t border-border/60 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <MicroLabel>Budget trace by attempt</MicroLabel>
        <p className="font-mono text-xs text-muted-foreground">
          ${recordedCost.toFixed(4)} recorded
          {absentCostCount > 0 ? ` · ${absentCostCount} cost absent` : ''}
        </p>
      </div>

      {recorded.length === 0 ? (
        <div className="grid min-h-56 place-items-center text-center">
          <div>
            <p className="font-mono text-3xl text-muted-foreground">∅</p>
            <p className="mt-3 text-sm text-muted-foreground">No telemetry has been recorded.</p>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">
            {theme && hasChartData ? (
              <ChartContainer
                theme={theme}
                axis={{ y: { min: 0 }, x: { visible: false } }}
                padding={{ top: 24, bottom: 12, left: 8, right: 8 }}
                className="h-72 w-full"
              >
                {tokenLayers.length > 0 && (
                  <BarSeries
                    id="task-tokens"
                    data={tokenLayers}
                    label="Tokens"
                    options={{ colors, stacking: 'normal', barWidthRatio: 0.65 }}
                  />
                )}
                {durations.length > 0 && (
                  <LineSeries
                    id="task-duration"
                    data={[durations]}
                    label="Duration (s)"
                    options={{
                      colors: [theme.line.color],
                      stacking: 'off',
                      lineWidth: 2,
                      areaFill: false,
                      pulse: false,
                    }}
                  />
                )}
                <YAxis />
                <Tooltip />
                <Legend
                  items={[
                    ...tokenKinds.map((kind, index) => ({
                      label: `${kind} tokens`,
                      color: colors[index % Math.max(colors.length, 1)] ?? theme.line.color,
                    })),
                    ...(durations.length > 0
                      ? [{ label: 'duration seconds', color: theme.line.color }]
                      : []),
                  ]}
                />
              </ChartContainer>
            ) : (
              <div className="grid h-72 place-items-center rounded-xl bg-foreground/[0.035] text-sm text-muted-foreground">
                Telemetry metadata exists, but no token or duration values were recorded.
              </div>
            )}
          </div>

          <ol className="space-y-2 font-mono text-xs">
            {recorded.map((attempt) => {
              const duration = durationSeconds(attempt)
              const totalTokens = attempt.tokens
                ? Object.values(attempt.tokens).reduce((total, value) => total + value, 0)
                : null

              return (
                <li key={attempt.id} className="rounded-xl bg-background/45 p-3">
                  <p className="truncate text-foreground">{attempt.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    {totalTokens === null
                      ? 'tokens absent'
                      : `${totalTokens.toLocaleString()} tokens`}{' '}
                    · {duration === null ? 'duration absent' : `${duration.toFixed(1)}s`}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {attempt.costUsd === null ? 'cost absent' : `$${attempt.costUsd.toFixed(4)}`}
                  </p>
                  <p className="mt-1 truncate text-muted-foreground">
                    {attempt.model ?? attempt.provider}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {absent.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <MicroLabel>No telemetry</MicroLabel>
          <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
            {absent.map((stage) => `${stage.nodeKey}#${stage.attempt}`).join(' · ')}
          </p>
        </div>
      )}
    </section>
  )
}
