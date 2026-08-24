import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ApiRequestError,
  getSpecConventions,
  listRepositories,
  setSpecConvention,
  type UpdateSpecConventionInput,
} from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'

const PROFILE_LABELS: Record<string, string> = {
  openspec: 'OpenSpec',
  custom: 'A suite at a path',
  none: 'No specification',
}

/**
 * REQ-923: which specification convention each repository's tasks run under. Only the
 * repositories the owner has set one for are listed — everything else is detected at
 * provisioning, and saying so once is more honest than listing every repository with
 * the word "detected" beside it.
 */
export function SpecConventionsSection() {
  const queryClient = useQueryClient()
  const [repoUrl, setRepoUrl] = useState('')
  const [profile, setProfile] = useState('openspec')
  const [suitePath, setSuitePath] = useState('')
  const [conventionNote, setConventionNote] = useState('')

  const conventions = useQuery({
    queryKey: queryKeys.specConventions,
    queryFn: ({ signal }) => getSpecConventions(signal),
  })
  const repositories = useQuery({
    queryKey: queryKeys.repositories,
    queryFn: ({ signal }) => listRepositories(signal),
  })
  const save = useMutation({
    mutationFn: (input: UpdateSpecConventionInput) => setSpecConvention(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.specConventions }),
  })

  const entries = Object.entries(conventions.data?.specConventions ?? {})
  const known = repositories.data?.repositories.map((repository) => repository.repoUrl) ?? []

  // AC-977 is enforced by the API, which answers 422; refusing here too means the
  // owner is told before a round trip rather than after one.
  const missingSuitePath = profile === 'custom' && suitePath.trim() === ''
  const canSave = repoUrl.trim() !== '' && !missingSuitePath

  function submit() {
    const setting =
      profile === 'custom'
        ? {
            profile: 'custom' as const,
            suitePath: suitePath.trim(),
            ...(conventionNote.trim() ? { conventionNote: conventionNote.trim() } : {}),
          }
        : { profile: profile as 'openspec' | 'none' }

    save.mutate(
      { repoUrl: repoUrl.trim(), setting },
      {
        onSuccess: () => {
          setRepoUrl('')
          setSuitePath('')
          setConventionNote('')
        },
      },
    )
  }

  return (
    <section className="panel space-y-5 p-5 sm:p-7">
      <div>
        <p className="micro-label text-cyan">Remembered across tasks</p>
        <h2 className="mt-2 text-lg font-semibold">Specification conventions</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Where a repository keeps its living specification, so planning writes changes against it
          rather than beside it. Every repository not listed here is detected when a task is
          provisioned.
        </p>
      </div>

      {conventions.isError && (
        <p className="field-error">
          {conventions.error instanceof ApiRequestError
            ? conventions.error.message
            : 'Could not load the conventions'}
        </p>
      )}
      {save.isError && (
        <p className="field-error">
          {save.error instanceof ApiRequestError ? save.error.message : 'Save failed'}
        </p>
      )}

      {conventions.isPending && <p className="text-sm text-muted">Loading conventions…</p>}

      {/* AC-979 — an empty list would read as "nothing is in force anywhere". */}
      {!conventions.isPending && entries.length === 0 && (
        <p className="text-sm text-muted">
          No repository has one set. Every repository is detected when a task is provisioned.
        </p>
      )}

      <ul className="space-y-3">
        {entries.map(([key, setting]) => (
          <li
            key={key}
            className="flex flex-wrap items-start justify-between gap-3 border border-border p-3"
          >
            <div className="min-w-0">
              <p className="break-all font-mono text-xs text-muted">{key}</p>
              <p className="mt-1 text-xs text-muted">
                {PROFILE_LABELS[setting.profile] ?? setting.profile}
                {setting.suitePath ? ` · ${setting.suitePath}` : ''}
              </p>
              {setting.conventionNote && (
                <p className="mt-1 text-xs text-muted">{setting.conventionNote}</p>
              )}
            </div>
            <button
              type="button"
              className="button-secondary"
              disabled={save.isPending}
              onClick={() => save.mutate({ repoUrl: key, setting: null })}
            >
              Use detection
            </button>
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-border pt-5">
        <label className="block text-sm" htmlFor="spec-convention-repo">
          Repository
          <input
            id="spec-convention-repo"
            className="input mt-1 w-full"
            list="spec-convention-known-repos"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/owner/repo"
          />
        </label>
        <datalist id="spec-convention-known-repos">
          {known.map((url) => (
            <option key={url} value={url} />
          ))}
        </datalist>

        <label className="block text-sm" htmlFor="spec-convention-profile">
          Convention
          <select
            id="spec-convention-profile"
            className="input mt-1 w-full"
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
          >
            {Object.entries(PROFILE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {profile === 'custom' && (
          <>
            <label className="block text-sm" htmlFor="spec-convention-path">
              Suite path
              <input
                id="spec-convention-path"
                className="input mt-1 w-full"
                value={suitePath}
                onChange={(event) => setSuitePath(event.target.value)}
                placeholder="docs/spec"
              />
            </label>
            {missingSuitePath && (
              <p className="field-error">
                A suite at a path needs the path it lives at, relative to the repository root.
              </p>
            )}

            <label className="block text-sm" htmlFor="spec-convention-note">
              What governs it
              <textarea
                id="spec-convention-note"
                className="input mt-1 w-full"
                rows={2}
                value={conventionNote}
                onChange={(event) => setConventionNote(event.target.value)}
                placeholder="Numbered requirements, one file per service."
              />
            </label>
          </>
        )}

        <button
          type="button"
          className="button-primary"
          disabled={!canSave || save.isPending}
          onClick={submit}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}
