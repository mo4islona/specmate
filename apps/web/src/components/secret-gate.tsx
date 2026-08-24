import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState, useSyncExternalStore } from 'react'
import { getSecret, setSecret, subscribeToSecret } from '../lib/secret-store.ts'
import { Button, Field, Input, MicroLabel, Note, Panel } from '../ui/index.ts'

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
      <Panel className="w-full max-w-md border-accent/35">
        <MicroLabel tone="accent">Owner channel</MicroLabel>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Authenticate SpecMate</h1>
        <Note className="mt-3">
          Enter the owner secret. It stays in this browser and is sent only in request headers.
        </Note>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <Field label="Owner secret" id="owner-secret">
            <Input
              type="password"
              autoComplete="current-password"
              value={candidate}
              onChange={(event) => setCandidate(event.currentTarget.value)}
            />
          </Field>

          <Button variant="primary" className="w-full" type="submit" disabled={!candidate.trim()}>
            Open control room
          </Button>
        </form>
      </Panel>
    </main>
  )
}
