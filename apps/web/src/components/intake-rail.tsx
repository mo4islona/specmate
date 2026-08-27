import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useDebounced } from '../hooks/use-debounced.ts'
import {
  type ForgeReference,
  getRepository,
  type IntakePreview,
  type MemoryEntry,
  previewIntake,
  probeRepository,
  type RecentTask,
  type ReferenceRead,
  type RepositoryDetail,
  type RepositoryProbe,
  readReference,
} from '../lib/api-client.ts'
import { formatAge } from '../lib/format.ts'
import { queryKeys } from '../lib/query-keys.ts'
import { repoLabel, repoWebUrl } from '../lib/repo-link.ts'
import {
  Badge,
  Chip,
  cn,
  Icon,
  MicroLabel,
  Note,
  Panel,
  QuietLink,
  Reveal,
  Skeleton,
  TextButton,
} from '../ui/index.ts'
import { signalText } from './tone.ts'

interface IntakeRailProps {
  /** The request as it stands. The rail reads it; it never writes it. */
  readonly description: string
  /** The repository the owner pinned, or empty for whatever the text resolves to. */
  readonly pinnedRepoUrl: string
  readonly onPin: (repoUrl: string) => void
}

/** Said in the rail's voice: why this repository, in words rather than a rule name. */
const VIA: Record<string, string> = {
  chosen: 'you chose it',
  'request-url': 'from the link in your request',
  'known-name': 'named in your request',
  default: 'your default repository',
}

type Candidate = IntakePreview['repository']['candidates'][number]

const STATE_TONE = {
  open: 'active',
  merged: 'done',
  closed: 'muted',
} as const

/**
 * What a launch of this request would do, and what the system already holds
 * about where it would go (REQ-1900).
 *
 * Everything here is read; nothing is edited. The one control is the repository
 * choice, and it writes into the same field a rejection's choice fills, so the
 * rail settles ambiguity earlier without inventing a second way to answer it.
 */
export function IntakeRail({ description, pinnedRepoUrl, onPin }: IntakeRailProps) {
  const settled = useDebounced(description)

  const preview = useQuery({
    queryKey: queryKeys.intakePreview(settled, pinnedRepoUrl),
    queryFn: ({ signal }) =>
      previewIntake({ description: settled, repoUrl: pinnedRepoUrl || undefined }, signal),
    // The previous answer stays on screen while the next one is fetched (AC-1909).
    placeholderData: keepPreviousData,
  })

  const repository = preview.data?.repository
  const repositoryId = repository?.known ? repository.id : null

  const holdings = useQuery({
    queryKey: queryKeys.repository(repositoryId ?? ''),
    queryFn: ({ signal }) => getRepository(repositoryId as string, signal),
    enabled: repositoryId !== null,
  })

  // A repository nothing has run against has no history to read, so what it is
  // gets asked of the forge instead: the default branch and whether the suite
  // its profile expects is in the tree. Mechanical, and no model in the path.
  const unseenRepoUrl = repository?.resolved && !repository.known ? repository.repoUrl : null

  const probe = useQuery({
    queryKey: queryKeys.repositoryProbe(unseenRepoUrl ?? ''),
    queryFn: ({ signal }) => probeRepository(unseenRepoUrl as string, signal),
    enabled: unseenRepoUrl !== null,
    staleTime: 5 * 60_000,
  })

  // Keyed on the reference rather than on the text, so writing another sentence
  // about one issue does not fetch that issue again (AC-1072).
  const references = useQueries({
    queries: (preview.data?.references ?? []).map((reference) => ({
      queryKey: queryKeys.reference(reference.url),
      queryFn: ({ signal }: { signal: AbortSignal }) => readReference(reference, signal),
      staleTime: 60_000,
    })),
  })

  const refreshing = preview.isFetching && preview.data !== undefined

  // Nothing has come back yet, and drawn slots here would be a promise the rail
  // cannot keep: on an untouched screen what is missing is not a response but a
  // request, so bars that sit there until somebody types read as a panel that is
  // stuck rather than one that is filling. It says nothing until it has
  // something to say, and `keepPreviousData` is what stops it emptying again on
  // the next keystroke.
  const answer = preview.data
  if (answer === undefined) return null

  // Nothing named, nothing referenced, nothing to report. An empty panel beside
  // the field is worse than no panel: it is a box that reads as broken.
  const silent =
    !answer.repository.resolved &&
    answer.repository.reason !== 'ambiguous' &&
    answer.references.length === 0

  if (silent) return null

  return (
    <Panel as="aside" className="space-y-6" aria-label="What this request resolves to">
      <RepositorySection
        preview={answer}
        refreshing={refreshing}
        pinned={pinnedRepoUrl}
        onPin={onPin}
      />

      <ReferencesSection
        references={answer.references}
        reads={references.map((query) => query.data)}
        loading={references.map((query) => query.isPending)}
      />

      {repositoryId !== null && (
        <HoldingsSections detail={holdings.data} loading={holdings.isPending} />
      )}

      {unseenRepoUrl !== null && (
        <UnseenSections repoUrl={unseenRepoUrl} probe={probe.data} loading={probe.isPending} />
      )}
    </Panel>
  )
}

interface RailSectionProps {
  readonly label: string
  readonly aside?: ReactNode
  readonly children: ReactNode
}

function RailSection({ label, aside, children }: RailSectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <MicroLabel as="h3">{label}</MicroLabel>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * Bars in the shape of a read that is genuinely in flight — the forge answering
 * about a repository the rail has already named. Never for a section that is
 * short of the owner's own text: a drawn wait is a promise that something is
 * coming, and nothing is coming until they type.
 */
function SlotLines({ widths }: { widths: readonly string[] }) {
  return (
    <div className="space-y-1.5">
      {widths.map((width) => (
        <Skeleton key={width} className={cn('h-3', width)} />
      ))}
    </div>
  )
}

interface RepositorySectionProps {
  readonly preview: IntakePreview
  readonly refreshing: boolean
  readonly pinned: string
  readonly onPin: (repoUrl: string) => void
}

function RepositorySection({ preview, refreshing, pinned, onPin }: RepositorySectionProps) {
  const { repository } = preview

  // A request that named nothing has nothing to report. Saying so in the rail
  // is a warning about a state the owner is simply still in — they have not
  // finished writing. Intake's own rejection is what catches it if they launch
  // anyway (AC-972), and that arrives at the moment it matters.
  if (!repository.resolved && repository.reason !== 'ambiguous') return null

  return (
    <RailSection
      label="Repository"
      aside={
        refreshing ? (
          <span className="font-mono text-[0.62rem] text-muted-foreground" role="status">
            reading…
          </span>
        ) : null
      }
    >
      <Reveal refreshing={refreshing} className="space-y-2">
        {repository.resolved ? (
          <>
            <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
              <Icon name="repo" size="xs" className="opacity-70" />
              <RepositoryName repoUrl={repository.repoUrl} />
            </p>

            <Note size="xs">{VIA[repository.via ?? ''] ?? 'resolved at intake'}</Note>

            {pinned !== '' && (
              <TextButton onClick={() => onPin('')}>
                Release this choice and follow the request
              </TextButton>
            )}
          </>
        ) : (
          <Unresolved repository={repository} onPin={onPin} />
        )}
      </Reveal>
    </RailSection>
  )
}

/** Beyond this the rail is a repository list rather than a panel about one launch. */
const CANDIDATES_SHOWN = 6

interface UnresolvedProps {
  readonly repository: { readonly candidates: Candidate[] }
  readonly onPin: (repoUrl: string) => void
}

/**
 * The one unresolved case worth reporting: the request named repositories and
 * meant more than one of them. That is something the owner wrote and can settle
 * in a click — unlike naming none, which is just an unfinished sentence.
 */
function Unresolved({ repository, onPin }: UnresolvedProps) {
  const shown = repository.candidates.slice(0, CANDIDATES_SHOWN)
  const hidden = repository.candidates.length - shown.length

  return (
    <>
      <Note size="xs" className={signalText('stopped')}>
        Your request names more than one repository the system knows.
      </Note>

      {shown.length > 0 && (
        <div className="flex flex-col items-start gap-1.5 pt-1">
          {shown.map((candidate) => (
            <Chip
              key={candidate.id}
              // A remote can be a filesystem path as long as a paragraph. It is
              // still the whole identity, so it is kept on the control's title
              // rather than shortened away.
              className="max-w-full"
              title={candidate.repoUrl}
              onClick={() => onPin(candidate.repoUrl)}
            >
              <span className="min-w-0 truncate">{repoLabel(candidate.repoUrl)}</span>
            </Chip>
          ))}

          {hidden > 0 && <Note size="xs">and {hidden} more</Note>}
        </div>
      )}
    </>
  )
}

interface SpecConventionProps {
  readonly profile: string | null
  readonly suitePath: string | null
  /** Where the answer came from, when it came from something that actually ran. */
  readonly source: string | null
}

/**
 * Which specification governs this repository. Never a guess: either a real
 * checkout resolved it on an earlier task, or the tree was probed for the path
 * the profile expects. Both run through the same rules provisioning uses.
 */
function SpecConvention({ profile, suitePath, source }: SpecConventionProps) {
  if (!profile || profile === 'none') {
    // Marked rather than merely said: this is the one answer here that changes
    // the shape of the run. A mark, not a colour — the budget spends amber on
    // what is waiting for the owner, and nothing is.
    return (
      <Note size="xs" className="flex items-start gap-1.5">
        <Icon name="info" size="sm" className="mt-px shrink-0" />
        <span>
          No specification suite — the specifying stages are skipped, and acceptance goes in the
          brief.
        </span>
      </Note>
    )
  }

  return (
    <>
      <p className="space-x-2 font-mono text-xs">
        <span className="text-foreground">{profile}</span>
        {suitePath && <span className="text-muted-foreground">{suitePath}</span>}
      </p>
      {source && (
        <Note size="xs" className="mt-1">
          from {source}
        </Note>
      )}
    </>
  )
}

interface UnseenSectionsProps {
  readonly repoUrl: string
  readonly probe: RepositoryProbe | undefined
  readonly loading: boolean
}

/**
 * A repository with no history here. There is nothing to remember and no task
 * to list, but what governs it is still a fact the forge can answer, and the
 * answer is worth having before the launch rather than after the first stage.
 */
function UnseenSections({ repoUrl, probe, loading }: UnseenSectionsProps) {
  return (
    <>
      <RailSection label="Specification">
        {loading ? (
          <SlotLines widths={['w-2/3']} />
        ) : (
          <Reveal>
            {probe?.specConvention ? (
              <SpecConvention
                profile={probe.specConvention.profile}
                suitePath={probe.specConvention.suitePath}
                source="its tree, read just now"
              />
            ) : (
              <Note size="xs">
                {repoWebUrl(repoUrl)
                  ? 'Could not read the tree — the pipeline resolves this when the task is provisioned.'
                  : 'Resolved when the task is provisioned.'}
              </Note>
            )}
          </Reveal>
        )}
      </RailSection>

      <RailSection label="History">
        <Reveal>
          <Note size="xs">
            Nothing has run against this repository yet — this would be the first task
            {probe?.probe.read && probe.probe.defaultBranch
              ? `, from ${probe.probe.defaultBranch}`
              : ''}
            .
          </Note>
        </Reveal>
      </RailSection>
    </>
  )
}

function RepositoryName({ repoUrl }: { repoUrl: string }) {
  const label = repoLabel(repoUrl)
  const href = repoWebUrl(repoUrl)

  if (!href) return <span className="truncate">{label}</span>

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="truncate text-muted-foreground hover:text-foreground hover:underline"
    >
      {label}
    </a>
  )
}

interface ReferencesSectionProps {
  readonly references: readonly ForgeReference[]
  readonly reads: readonly (ReferenceRead | undefined)[]
  readonly loading: readonly boolean[]
}

/**
 * A reference written as a link stays whether or not it reads; one guessed from
 * `owner/repo#1` shows only once it does, because that shape is also what a file
 * path looks like and only the read tells them apart (AC-1911).
 */
function ReferencesSection({ references, reads, loading }: ReferencesSectionProps) {
  const shown = references
    .map((reference, index) => ({
      reference,
      read: reads[index],
      pending: loading[index] ?? false,
    }))
    .filter(({ reference, read, pending }) => reference.explicit || pending || read?.read)

  if (shown.length === 0) return null

  return (
    <RailSection label="Referenced">
      <ul className="space-y-2">
        {shown.map(({ reference, read, pending }) => (
          <li key={reference.url}>
            <ReferenceRow reference={reference} read={read} pending={pending} />
          </li>
        ))}
      </ul>
    </RailSection>
  )
}

interface ReferenceRowProps {
  readonly reference: ForgeReference
  readonly read: ReferenceRead | undefined
  readonly pending: boolean
}

function ReferenceRow({ reference, read, pending }: ReferenceRowProps) {
  const number = `#${reference.number}`

  return (
    <Reveal className="space-y-1">
      <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <a
          href={reference.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-mono text-muted-foreground hover:text-foreground hover:underline"
        >
          {repoLabel(`${reference.host}/${reference.owner}/${reference.repo}`)}
          {number}
        </a>

        {read?.read && <span className="min-w-0 truncate">{read.detail.title}</span>}
      </p>

      {pending && !read && <Skeleton className="h-3 w-2/3" />}

      {read?.read && (
        <p className="flex flex-wrap items-center gap-1">
          <Badge tone={STATE_TONE[read.detail.state]}>{read.detail.state}</Badge>
          {read.detail.author && (
            <span className="font-mono text-[0.62rem] text-muted-foreground">
              {read.detail.author}
            </span>
          )}
          {read.detail.labels.slice(0, 3).map((label) => (
            <Badge key={label} tone="muted">
              {label}
            </Badge>
          ))}
        </p>
      )}

      {read && !read.read && (
        <Note size="xs" className={signalText('asking')}>
          {read.detail}
        </Note>
      )}
    </Reveal>
  )
}

interface HoldingsSectionsProps {
  readonly detail: RepositoryDetail | undefined
  readonly loading: boolean
}

/** What the system holds about the repository the request resolved to (AC-1906). */
function HoldingsSections({ detail, loading }: HoldingsSectionsProps) {
  if (loading || !detail) {
    return (
      <>
        <RailSection label="Specification">
          <SlotLines widths={['w-2/3']} />
        </RailSection>
        <RailSection label="Remembers">
          <SlotLines widths={['w-full', 'w-5/6']} />
        </RailSection>
        <RailSection label="History">
          <SlotLines widths={['w-1/2', 'w-3/4']} />
        </RailSection>
      </>
    )
  }

  return (
    <>
      <RailSection label="Specification">
        <Reveal>
          <SpecConvention
            profile={
              detail.specConvention.resolved?.profile ??
              detail.specConvention.setting?.profile ??
              null
            }
            suitePath={
              detail.specConvention.resolved?.suitePath ??
              detail.specConvention.setting?.suitePath ??
              null
            }
            source={detail.specConvention.resolved ? 'the last task that ran here' : null}
          />
        </Reveal>
      </RailSection>

      <RailSection
        label="Remembers"
        aside={
          detail.memory.total > 0 ? (
            <span className="font-mono text-[0.62rem] text-muted-foreground">
              {detail.memory.total}
            </span>
          ) : null
        }
      >
        <Reveal>
          {detail.memory.entries.length > 0 ? (
            <ul className="space-y-1.5">
              {detail.memory.entries.map((entry) => (
                <MemoryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : (
            <Note size="xs">Nothing yet. Stages add to this as they work here.</Note>
          )}
        </Reveal>
      </RailSection>

      <RailSection label="History">
        <Reveal className="space-y-2">
          <Note size="xs">
            {detail.repository.taskCount === 1
              ? 'One task has run here'
              : `${detail.repository.taskCount} tasks have run here`}
            {detail.repository.baseBranch ? `, from ${detail.repository.baseBranch}` : ''}.
          </Note>

          {detail.recentTasks.length > 0 && (
            <ul className="space-y-1">
              {detail.recentTasks.map((task) => (
                <RecentTaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}

          {detail.coverageWaiver && (
            <Note size="xs" className={signalText('asking')}>
              A coverage gap is accepted for this repository.
            </Note>
          )}
        </Reveal>
      </RailSection>
    </>
  )
}

function MemoryRow({ entry }: { entry: MemoryEntry }) {
  return (
    <li className="text-xs leading-5">
      <span className="text-foreground">{entry.description}</span>
      {entry.borrowedFrom && (
        <Badge tone="muted" className="ml-1.5">
          borrowed
        </Badge>
      )}
    </li>
  )
}

function RecentTaskRow({ task }: { task: RecentTask }) {
  return (
    <li className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
      <QuietLink href={`/tasks/${task.id}`} className="min-w-0 truncate">
        {task.title}
      </QuietLink>
      <span className="shrink-0 font-mono text-[0.62rem] text-muted-foreground">
        {formatAge(task.createdAt)}
      </span>
    </li>
  )
}
