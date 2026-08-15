import { z } from 'zod'

/** Docker/`.env` supply unset variables as empty strings; treat those as absent. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).optional())

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  /** Single-owner auth (§9.3). Unset is allowed only outside production. */
  SPECMATE_PASSWORD: optionalString,
})

export type Config = z.infer<typeof Env>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env)
  if (!parsed.success) {
    throw new Error(`invalid environment:\n${z.prettifyError(parsed.error)}`)
  }
  const config = parsed.data
  if (config.NODE_ENV === 'production' && !config.SPECMATE_PASSWORD) {
    throw new Error('SPECMATE_PASSWORD is required in production')
  }
  return config
}
