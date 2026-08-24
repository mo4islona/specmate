import { ApiRequestError } from '../lib/api-client.ts'
import { ErrorNote } from '../ui/index.ts'

interface RequestErrorProps {
  /** A query's or mutation's `error` — null while nothing has gone wrong. */
  readonly error: unknown
  /** What to say when the failure did not come from the API: a dropped connection, a parse. */
  readonly fallback: string
  readonly className?: string
}

/**
 * What a failed request is allowed to say. Only the API's own rejections carry
 * a message written for the owner; anything else is a runtime error whose text
 * is written for whoever is reading a stack trace, and putting `Failed to
 * fetch` under a Save button explains nothing.
 */
export function RequestError({ error, fallback, className }: RequestErrorProps) {
  if (!error) return null

  return (
    <ErrorNote className={className}>
      {error instanceof ApiRequestError ? error.message : fallback}
    </ErrorNote>
  )
}
