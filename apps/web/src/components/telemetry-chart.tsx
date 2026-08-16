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
import type { TaskDetail } from '../lib/api-client.ts'

type Stage = TaskDetail['stages'][number]
type ChartTheme = ReturnType<typeof createTheme>['theme']

const CHART_START = Date.UTC(2026, 0, 1)
const CHART_STEP_MS = 60_000

function useMissionControlChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(null)

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    const token = (name: string) => styles.getPropertyValue(name).trim()
    setTheme(
      createTheme({
        name: 'SpecMate mission control',
        background: token('--color-surface'),
        chartGradient: [token('--color-elevated'), token('--color-surface')],
        typography: {
          fontFamily: token('--font-mono'),
          fontSize: 11,
          axisFontSize: 10,
          yFontSize: 10,
          tooltipFontSize: 11,
        },
        grid: { color: token('--color-border'), style: 'dashed' },
        line: {
          color: token('--color-cyan'),
          areaTopColor: token('--color-cyan'),
          areaBottomColor: token('--color-surface'),
        },
        seriesColors: [
          token('--color-phosphor'),
          token('--color-amber'),
          token('--color-cyan'),
          token('--color-status-active'),
        ],
        crosshair: {
          color: token('--color-phosphor'),
          labelBackground: token('--color-elevated'),
          labelTextColor: token('--color-text'),
        },
        axis: { textColor: token('--color-muted') },
        tooltip: {
          background: token('--color-elevated'),
          textColor: token('--color-text'),
          borderColor: token('--color-border-bright'),
        },
        fontUrl: null,
      }).theme,
    )
  }, [])

  return theme
}

function durationSeconds(stage: Stage): number | null {
  const started = stage.telemetry?.startedAt
  const finished = stage.telemetry?.finishedAt
  if (!started || !finished) {
    return null
  }

  return Math.max(0, (new Date(finished).getTime() - new Date(started).getTime()) / 1_000)
}

export function TelemetryChart({ stages }: { stages: Stage[] }) {
  const theme = useMissionControlChartTheme()
  const recorded = stages.filter((stage) => stage.telemetry !== null)
  const absent = stages.filter((stage) => stage.telemetry === null)
  const tokenKinds = [
    ...new Set(recorded.flatMap((stage) => Object.keys(stage.telemetry?.tokens ?? {}))),
  ]
  const colors = theme?.seriesColors ?? []
  const tokenLayers = tokenKinds.map((kind) =>
    recorded.map((stage, index) => ({
      time: CHART_START + index * CHART_STEP_MS,
      value: stage.telemetry?.tokens?.[kind] ?? 0,
    })),
  )
  const durations = recorded.flatMap((stage, index) => {
    const duration = durationSeconds(stage)

    return duration === null ? [] : [{ time: CHART_START + index * CHART_STEP_MS, value: duration }]
  })
  const hasChartData = tokenLayers.length > 0 || durations.length > 0

  return (
    <section className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="micro-label text-cyan">Stage telemetry</p>
          <h2 className="mt-2 text-lg font-semibold">Budget trace by attempt</h2>
        </div>
        <p className="font-mono text-xs text-muted">stacked tokens · duration seconds</p>
      </div>

      {recorded.length === 0 ? (
        <div className="grid min-h-56 place-items-center text-center">
          <div>
            <p className="font-mono text-3xl text-muted">∅</p>
            <p className="mt-3 text-sm text-muted">No telemetry has been recorded.</p>
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
                    id="stage-tokens"
                    data={tokenLayers}
                    label="Tokens"
                    options={{ colors, stacking: 'normal', barWidthRatio: 0.65 }}
                  />
                )}
                {durations.length > 0 && (
                  <LineSeries
                    id="stage-duration"
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
              <div className="grid h-72 place-items-center border border-border text-sm text-muted">
                Telemetry metadata exists, but no token or duration values were recorded.
              </div>
            )}
          </div>

          <ol className="space-y-2 font-mono text-xs">
            {recorded.map((stage) => {
              const duration = durationSeconds(stage)
              const totalTokens = Object.values(stage.telemetry?.tokens ?? {}).reduce(
                (total, value) => total + value,
                0,
              )

              return (
                <li key={stage.id} className="border border-border bg-ground/45 p-3">
                  <p className="truncate text-text">
                    {stage.nodeKey} / attempt {stage.attempt}
                  </p>
                  <p className="mt-1 text-muted">
                    {totalTokens.toLocaleString()} tokens ·{' '}
                    {duration === null ? 'duration absent' : `${duration.toFixed(1)}s`}
                  </p>
                  <p className="mt-1 truncate text-cyan">
                    {stage.telemetry?.model ?? stage.provider}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {absent.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="micro-label text-muted">No telemetry</p>
          <p className="mt-2 font-mono text-xs leading-6 text-muted">
            {absent.map((stage) => `${stage.nodeKey}#${stage.attempt}`).join(' · ')}
          </p>
        </div>
      )}
    </section>
  )
}
