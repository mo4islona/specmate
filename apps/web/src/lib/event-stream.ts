import { ownerFetch, type TimelineEvent } from './api-client.ts'

export type StreamConnectionState = 'connecting' | 'live' | 'stale'

export type EventFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface SseFrame {
  id?: string
  event?: string
  data: string
}

export interface EventStreamOptions {
  taskId: string
  secret: string
  initialCursor?: number
  signal: AbortSignal
  onEvent: (event: TimelineEvent) => void
  onConnection: (state: StreamConnectionState) => void
  fetcher?: EventFetch
  retryDelayMs?: number
}

const DEFAULT_RETRY_DELAY_MS = 1_000

function findFrameBoundary(buffer: string): { at: number; length: number } | null {
  const unix = buffer.indexOf('\n\n')
  const windows = buffer.indexOf('\r\n\r\n')
  if (unix === -1 && windows === -1) {
    return null
  }
  if (unix === -1 || (windows !== -1 && windows < unix)) {
    return { at: windows, length: 4 }
  }

  return { at: unix, length: 2 }
}

export class SseParser {
  #buffer = ''

  push(chunk: string): SseFrame[] {
    this.#buffer += chunk
    const frames: SseFrame[] = []
    let boundary = findFrameBoundary(this.#buffer)
    while (boundary) {
      const raw = this.#buffer.slice(0, boundary.at).replaceAll('\r\n', '\n')
      this.#buffer = this.#buffer.slice(boundary.at + boundary.length)
      const frame = parseFrame(raw)
      if (frame) {
        frames.push(frame)
      }
      boundary = findFrameBoundary(this.#buffer)
    }

    return frames
  }
}

function parseFrame(raw: string): SseFrame | null {
  const data: string[] = []
  let id: string | undefined
  let event: string | undefined
  for (const line of raw.split('\n')) {
    if (line.startsWith(':') || line.length === 0) {
      continue
    }

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const untrimmed = separator === -1 ? '' : line.slice(separator + 1)
    const value = untrimmed.startsWith(' ') ? untrimmed.slice(1) : untrimmed
    if (field === 'data') data.push(value)
    if (field === 'id') id = value
    if (field === 'event') event = value
  }
  if (data.length === 0) {
    return null
  }

  return { id, event, data: data.join('\n') }
}

function parseTimelineEvent(frame: SseFrame): TimelineEvent | null {
  try {
    const value = JSON.parse(frame.data) as TimelineEvent
    if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq)) {
      return null
    }

    return value
  } catch {
    return null
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()

      return
    }

    const timer = setTimeout(resolve, delayMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export async function consumeTaskEventStream(options: EventStreamOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  let cursor = options.initialCursor ?? 0

  while (!options.signal.aborted) {
    options.onConnection('connecting')
    try {
      const headers = new Headers({
        accept: 'text/event-stream',
        authorization: `Bearer ${options.secret}`,
      })
      if (cursor > 0) {
        headers.set('Last-Event-ID', String(cursor))
      }

      const response = await ownerFetch(
        `/api/v1/tasks/${encodeURIComponent(options.taskId)}/events/stream`,
        { headers, signal: options.signal },
        fetcher,
      )
      if (response.status === 401) {
        return
      }
      if (!response.ok || !response.body) {
        throw new Error(`event stream failed with status ${response.status}`)
      }

      options.onConnection('live')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = new SseParser()
      while (!options.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }

        for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          const event = parseTimelineEvent(frame)
          if (!event || event.seq <= cursor) {
            continue
          }

          cursor = event.seq
          options.onEvent(event)
        }
      }
      await reader.cancel().catch(() => undefined)
    } catch (error) {
      if (options.signal.aborted) {
        return
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
    }

    if (!options.signal.aborted) {
      options.onConnection('stale')
      await waitForRetry(retryDelayMs, options.signal)
    }
  }
}
