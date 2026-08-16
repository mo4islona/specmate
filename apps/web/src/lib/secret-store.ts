const SECRET_KEY = 'specmate.owner-secret'

const listeners = new Set<() => void>()
let cachedSecret: string | null | undefined

function readStoredSecret(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(SECRET_KEY)
}

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

if (typeof window !== 'undefined') {
  // Keeps tabs in sync: a 401 in one tab clears the secret, and every other
  // open tab must stop sending the now-invalid token instead of caching it.
  window.addEventListener('storage', (event) => {
    if (event.key !== SECRET_KEY) {
      return
    }

    cachedSecret = event.newValue
    emitChange()
  })
}

export function getSecret(): string | null {
  if (cachedSecret === undefined) {
    cachedSecret = readStoredSecret()
  }

  return cachedSecret
}

export function setSecret(secret: string): void {
  const normalized = secret.trim()
  cachedSecret = normalized.length > 0 ? normalized : null
  if (typeof window !== 'undefined') {
    if (cachedSecret) {
      window.localStorage.setItem(SECRET_KEY, cachedSecret)
    } else {
      window.localStorage.removeItem(SECRET_KEY)
    }
  }
  emitChange()
}

export function clearSecret(): void {
  setSecret('')
}

export function subscribeToSecret(listener: () => void): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}
