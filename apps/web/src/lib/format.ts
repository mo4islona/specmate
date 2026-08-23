export function formatAge(value: string | Date): string {
  const timestamp = new Date(value).getTime()
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 48) return `${elapsedHours}h`

  return `${Math.floor(elapsedHours / 24)}d`
}

/** Time only: inside a thread the day is carried by the chapter, not by every line. */
export function formatClock(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/** A run log's lines are seconds apart and all from one run: the day is the run's, not each line's. */
export function formatRunClock(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}

export function formatTimestamp(value: string | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}
