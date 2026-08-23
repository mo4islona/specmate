import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

export const API_ERROR_CODES = [
  'validation',
  'unauthenticated',
  'not_found',
  'conflict',
  'internal',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]
export type ApiErrorStatus = 400 | 401 | 404 | 409 | 500 | 503
export type ValidationFields = Record<string, string[]>

export interface ApiErrorOptions {
  status: ApiErrorStatus
  fields?: ValidationFields
  /** Values the offending field would have accepted — the client offers them as a choice. */
  candidates?: readonly string[]
}

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: ApiErrorStatus
  readonly fields?: ValidationFields
  readonly candidates?: readonly string[]

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    options: ApiErrorOptions,
  ) {
    super(message)
    this.status = options.status
    this.fields = options.fields
    this.candidates = options.candidates
  }
}

export function handleApiError(error: unknown, context: Context): Response {
  if (error instanceof ApiError) {
    return context.json(
      {
        code: error.code,
        detail: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(error.candidates ? { candidates: error.candidates } : {}),
      },
      error.status,
    )
  }

  if (error instanceof HTTPException && error.status === 400) {
    return context.json(
      {
        code: 'validation' as const,
        detail: error.message,
        fields: { body: [error.message] },
      },
      400,
    )
  }

  console.error(error)

  return context.json({ code: 'internal' as const, detail: 'internal server error' }, 500)
}
