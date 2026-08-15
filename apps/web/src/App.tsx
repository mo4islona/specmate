import { useEffect, useState } from 'react'

type Health = { ok: boolean; db?: string; detail?: string }

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/readyz', { signal: controller.signal })
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">SpecMate</h1>
        <p className="text-sm opacity-60">
          OpenSpec-driven agent orchestration — Phase 0 skeleton.
        </p>
      </header>

      <section className="rounded-lg border border-current/15 p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide opacity-60">API</h2>
        {error && <p className="text-sm text-red-500">unreachable: {error}</p>}
        {!error && !health && <p className="text-sm opacity-60">checking…</p>}
        {health && (
          <p className="font-mono text-sm">
            ready={String(health.ok)} db={health.db ?? 'unknown'}
          </p>
        )}
      </section>

      <p className="text-sm opacity-50">
        Attention Inbox, task sidebar and chat timeline arrive in Phase 1.
      </p>
    </main>
  )
}
