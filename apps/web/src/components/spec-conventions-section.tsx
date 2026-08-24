import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  getSpecConventions,
  listRepositories,
  setSpecConvention,
  type UpdateSpecConventionInput,
} from '../lib/api-client.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { Button, Field, Input, ListRow, Note, Section, Select, Textarea } from '../ui/index.ts'
import { RequestError } from './request-error.tsx'

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
    <Section
      eyebrow="Remembered across tasks"
      title="Specification conventions"
      description="Where a repository keeps its living specification, so planning writes changes against it rather than beside it. Every repository not listed here is detected when a task is provisioned."
    >
      <RequestError error={conventions.error} fallback="Could not load the conventions" />
      <RequestError error={save.error} fallback="Save failed" />

      {conventions.isPending && <Note>Loading conventions…</Note>}

      {/* AC-979 — an empty list would read as "nothing is in force anywhere". */}
      {!conventions.isPending && entries.length === 0 && (
        <Note>
          No repository has one set. Every repository is detected when a task is provisioned.
        </Note>
      )}

      <ul className="space-y-3">
        {entries.map(([key, setting]) => (
          <ListRow
            key={key}
            primary={<p className="break-all font-mono text-xs text-muted">{key}</p>}
            secondary={
              <>
                <Note size="xs" className="mt-1">
                  {PROFILE_LABELS[setting.profile] ?? setting.profile}
                  {setting.suitePath ? ` · ${setting.suitePath}` : ''}
                </Note>
                {setting.conventionNote && (
                  <Note size="xs" className="mt-1">
                    {setting.conventionNote}
                  </Note>
                )}
              </>
            }
            action={
              <Button
                disabled={save.isPending}
                onClick={() => save.mutate({ repoUrl: key, setting: null })}
              >
                Use detection
              </Button>
            }
          />
        ))}
      </ul>

      <div className="space-y-4 border-t border-border pt-5">
        <Field label="Repository" id="spec-convention-repo">
          <Input
            list="spec-convention-known-repos"
            mono
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.currentTarget.value)}
            placeholder="https://github.com/owner/repo"
          />
        </Field>
        <datalist id="spec-convention-known-repos">
          {known.map((url) => (
            <option key={url} value={url} />
          ))}
        </datalist>

        <Field label="Convention" id="spec-convention-profile">
          <Select value={profile} onChange={(event) => setProfile(event.currentTarget.value)}>
            {Object.entries(PROFILE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {profile === 'custom' && (
          <>
            <Field
              label="Suite path"
              id="spec-convention-path"
              error={
                missingSuitePath
                  ? 'A suite at a path needs the path it lives at, relative to the repository root.'
                  : undefined
              }
            >
              <Input
                mono
                value={suitePath}
                onChange={(event) => setSuitePath(event.currentTarget.value)}
                placeholder="docs/spec"
              />
            </Field>

            <Field label="What governs it" id="spec-convention-note">
              <Textarea
                rows={2}
                value={conventionNote}
                onChange={(event) => setConventionNote(event.currentTarget.value)}
                placeholder="Numbered requirements, one file per service."
              />
            </Field>
          </>
        )}

        <Button
          variant="primary"
          disabled={!canSave}
          pending={save.isPending}
          pendingLabel="Saving…"
          onClick={submit}
        >
          Save
        </Button>
      </div>
    </Section>
  )
}
