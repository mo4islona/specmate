import type { Context } from 'hono'
import type { z } from 'zod'
import { ApiError, type ValidationFields } from '../errors.ts'

function validationFields(error: z.ZodError): ValidationFields {
  const fields: ValidationFields = {}
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? 'body'
    fields[field] = [...(fields[field] ?? []), issue.message]
  }

  return fields
}

// hono's validator('json', ...) only parses the body when Content-Type matches
// its JSON regex, silently treating a missing/wrong header as an empty body.
// Ignore the pre-parsed value and read the body ourselves — c.req.json() does
// not gate on the header — so a client that omits it still validates correctly.
export function validateJson<T extends z.ZodType>(schema: T) {
  return async (_value: unknown, c: Context): Promise<z.output<T>> => {
    const body = await c.req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ApiError('validation', 'request body is invalid', {
        status: 400,
        fields: validationFields(parsed.error),
      })
    }

    return parsed.data
  }
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return (value: unknown): z.output<T> => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new ApiError('validation', 'request query is invalid', {
        status: 400,
        fields: validationFields(parsed.error),
      })
    }

    return parsed.data
  }
}
