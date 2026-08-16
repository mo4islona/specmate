import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from 'react'
import { getSecret, setSecret, subscribeToSecret } from '../lib/secret-store.ts'

interface SecretGateProps {
  children: ReactNode
}

export function SecretGate({ children }: SecretGateProps) {
  const queryClient = useQueryClient()
  const secret = useSyncExternalStore(subscribeToSecret, getSecret, () => null)
  const [candidate, setCandidate] = useState('')

  if (secret) {
    return children
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const normalized = candidate.trim()
    if (!normalized) {
      return
    }

    queryClient.clear()
    setSecret(normalized)
  }

  return (
    <main className="grid min-h-full place-items-center bg-ground p-5 text-text">
      <section className="panel w-full max-w-md border-phosphor/35 p-6 sm:p-8">
        <p className="micro-label text-phosphor">Owner channel</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Authenticate SpecMate</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Enter the owner secret. It stays in this browser and is sent only in request headers.
        </p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          <label className="field-label" htmlFor="owner-secret">
            Owner secret
          </label>
          <input
            id="owner-secret"
            type="password"
            autoComplete="current-password"
            value={candidate}
            onChange={(event) => setCandidate(event.currentTarget.value)}
            className="control w-full"
          />
          <button className="button-primary w-full" type="submit" disabled={!candidate.trim()}>
            Open control room
          </button>
        </form>
      </section>
    </main>
  )
}
