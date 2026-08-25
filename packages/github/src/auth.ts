import { appSettings, type DbClient } from '@specmate/db'
import { eq, sql } from 'drizzle-orm'

const GITHUB_AUTH_KEY = 'github-auth'
const REFRESH_WINDOW_MS = 5 * 60_000

export interface GitHubAuth {
  readonly accessToken: string
  readonly refreshToken: string
  readonly accessTokenExpiresAt: string
  readonly refreshTokenExpiresAt: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

export class GitHubLoginRequiredError extends Error {
  constructor(detail = 'no GitHub authorization is stored') {
    super(`${detail}; run github-login to authorize GitHub access`)
    this.name = 'GitHubLoginRequiredError'
  }
}

export async function saveGitHubAuth(db: DbClient, auth: GitHubAuth): Promise<void> {
  const value = auth as unknown as Record<string, unknown>
  await db
    .insert(appSettings)
    .values({ key: GITHUB_AUTH_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    })
}

async function readGitHubAuth(db: DbClient): Promise<GitHubAuth> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, GITHUB_AUTH_KEY))
    .limit(1)
  const auth = row?.value as Partial<GitHubAuth> | undefined
  if (
    !auth?.accessToken ||
    !auth.refreshToken ||
    !auth.accessTokenExpiresAt ||
    !auth.refreshTokenExpiresAt
  ) {
    throw new GitHubLoginRequiredError()
  }

  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accessTokenExpiresAt: auth.accessTokenExpiresAt,
    refreshTokenExpiresAt: auth.refreshTokenExpiresAt,
  }
}

function accessTokenIsFresh(auth: GitHubAuth, now: Date): boolean {
  const accessExpiry = new Date(auth.accessTokenExpiresAt)

  return (
    !Number.isNaN(accessExpiry.getTime()) &&
    accessExpiry.getTime() - now.getTime() > REFRESH_WINDOW_MS
  )
}

export async function githubToken(options: {
  db: DbClient
  clientId?: string
  now?: () => Date
  fetch?: typeof fetch
}): Promise<string> {
  const now = options.now?.() ?? new Date()

  return options.db.transaction(async (tx) => {
    // GitHub invalidates a refresh token once it is redeemed, so two callers
    // racing on the same stale refresh token would have one succeed and the
    // other get rejected. The advisory lock serializes the read-decide-write
    // sequence per stored credential; the freshness re-check right after
    // acquiring it means a caller that waited behind a refresh that already
    // happened uses that refresh's result instead of racing a second one.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${GITHUB_AUTH_KEY}))`)

    const auth = await readGitHubAuth(tx)
    const refreshExpiry = new Date(auth.refreshTokenExpiresAt)
    if (Number.isNaN(refreshExpiry.getTime()) || refreshExpiry <= now) {
      throw new GitHubLoginRequiredError('the stored GitHub refresh token has expired')
    }
    if (accessTokenIsFresh(auth, now)) {
      return auth.accessToken
    }

    if (!options.clientId) {
      throw new GitHubLoginRequiredError('GITHUB_APP_CLIENT_ID is not configured')
    }

    const body = new URLSearchParams({
      client_id: options.clientId,
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
    })
    const response = await (options.fetch ?? fetch)('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }).catch((error: unknown) => {
      throw new GitHubLoginRequiredError(
        `GitHub token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    const result = (await response.json()) as TokenResponse
    if (
      !response.ok ||
      !result.access_token ||
      !result.refresh_token ||
      !result.expires_in ||
      !result.refresh_token_expires_in
    ) {
      throw new GitHubLoginRequiredError(
        `GitHub token refresh was rejected: ${result.error_description ?? result.error ?? response.statusText}`,
      )
    }
    const refreshed = authFromTokenResponse(result, now)
    await saveGitHubAuth(tx, refreshed)

    return refreshed.accessToken
  })
}

export function authFromTokenResponse(result: TokenResponse, now = new Date()): GitHubAuth {
  if (
    !result.access_token ||
    !result.refresh_token ||
    !result.expires_in ||
    !result.refresh_token_expires_in
  ) {
    throw new Error('GitHub did not return a refreshable access token pair')
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    accessTokenExpiresAt: new Date(now.getTime() + result.expires_in * 1_000).toISOString(),
    refreshTokenExpiresAt: new Date(
      now.getTime() + result.refresh_token_expires_in * 1_000,
    ).toISOString(),
  }
}

export async function githubLogin(options: {
  db: DbClient
  clientId?: string
  log: (message: string) => void
  fetch?: typeof fetch
}): Promise<void> {
  if (!options.clientId) {
    throw new Error('GITHUB_APP_CLIENT_ID is required for github-login')
  }

  const fetcher = options.fetch ?? fetch
  const device = await requestDeviceCode(fetcher, options.clientId)
  const validFor = Math.round(device.expires_in / 60)
  options.log(
    `Open ${device.verification_uri} and enter code ${device.user_code} — valid for ${validFor} minutes`,
  )
  const token = await pollDeviceToken(fetcher, options.clientId, device)
  await saveGitHubAuth(options.db, authFromTokenResponse(token))
  options.log('GitHub authorization stored')
}

interface DeviceCode {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly expires_in: number
  readonly interval?: number
}

async function requestDeviceCode(fetcher: typeof fetch, clientId: string): Promise<DeviceCode> {
  const request = await fetcher('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: 'repo' }),
  })
  const device = (await request.json()) as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    expires_in?: number
    interval?: number
    error?: string
    error_description?: string
  }
  if (
    !request.ok ||
    !device.device_code ||
    !device.user_code ||
    !device.verification_uri ||
    !device.expires_in
  ) {
    throw new Error(
      `GitHub device authorization failed: ${device.error_description ?? device.error ?? request.statusText}`,
    )
  }

  return device as DeviceCode
}

async function pollDeviceToken(
  fetcher: typeof fetch,
  clientId: string,
  device: DeviceCode,
): Promise<TokenResponse> {
  const deadline = Date.now() + device.expires_in * 1_000
  let interval = (device.interval ?? 5) * 1_000
  while (Date.now() < deadline) {
    await Bun.sleep(interval)
    const response = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const token = (await response.json()) as TokenResponse
    if (response.ok && token.access_token) {
      return token
    }

    if (token.error === 'authorization_pending') {
      continue
    }

    if (token.error === 'slow_down') {
      interval += 5_000

      continue
    }
    throw new Error(
      `GitHub authorization failed: ${token.error_description ?? token.error ?? response.statusText}`,
    )
  }

  throw new Error('GitHub device authorization expired; run github-login again')
}
