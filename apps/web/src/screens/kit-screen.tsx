import { type ReactNode, useState } from 'react'
import { ThemeSection } from '../components/theme-section.tsx'
import { type Signal, signalBreathes, signalDot, signalText } from '../components/tone.ts'
import {
  Badge,
  type BadgeTone,
  Button,
  ButtonLink,
  type ButtonVariant,
  Checkbox,
  Chip,
  Console,
  ConsoleField,
  cn,
  Diff,
  Dot,
  Drawer,
  EmptyState,
  ErrorNote,
  ErrorState,
  Field,
  FieldLabel,
  FolderName,
  HoverHint,
  ICON_NAMES,
  ICON_SIZES,
  Icon,
  IconButton,
  InlineLink,
  Input,
  ListRow,
  LoadingState,
  Meter,
  MicroLabel,
  NavRow,
  Note,
  PageHeader,
  Panel,
  PanelLink,
  Popover,
  QuietLink,
  Reveal,
  Section,
  Select,
  SelectOption,
  Skeleton,
  SkeletonFacts,
  SkeletonRows,
  SkeletonText,
  StatBar,
  Subpanel,
  Textarea,
  TextButton,
  type Tone,
  Working,
} from '../ui/index.ts'

const BUTTONS: readonly ButtonVariant[] = [
  'primary',
  'warning',
  'destructive',
  'secondary',
  'ghost',
  'ghost-destructive',
]

const BADGES: readonly BadgeTone[] = ['active', 'parked', 'failed', 'done', 'muted', 'warning']

const TONES: readonly Tone[] = ['muted', 'primary', 'warning', 'destructive']

/** The whole colour budget, in the order it gets louder. */
const SIGNALS: readonly Signal[] = ['idle', 'settled', 'live', 'asking', 'stopped']

const SPECIMEN_DIFF = [
  '@@ -41,6 +41,7 @@',
  ' state per event, which is disproportionate to a rare, bounded cost',
  '-elsewhere in this engine (see `EPOCH_GAP_BOUND`). Traced through this',
  "-product's actual fold order, the realistic cases either fail before",
  '+elsewhere in this engine (see `EPOCH_GAP_BOUND`).',
  '+',
  '+The accumulator half is not a trade-off: an earlier series can fully fold',
  ' an event before a later one fails on the *same* event.',
].join('\n')

/** A change to code rather than to prose, which is what the colours are for. */
const SPECIMEN_CODE_DIFF = [
  '@@ -12,7 +12,8 @@',
  ' /** Every attempt at this node, oldest first. */',
  '-export function stageTokens(stage: Stage): number {',
  '-  return stage.telemetry.tokens.input_tokens',
  '+export function stageTokens(stage: Stage): number | null {',
  '+  const tokens = stage.telemetry?.tokens',
  '+  if (!tokens) return null // a run that reported nothing spent nothing',
  '+',
  '+  return Object.values(tokens).reduce((total, value) => total + value, 0)',
  ' }',
].join('\n')

/**
 * The same file at full context, so the specimen's hunk has something to open
 * into: forty lines of preamble is exactly what its `@@ -41` header stands in
 * for.
 */
const SPECIMEN_WHOLE_FILE = [
  '@@ -1,44 +1,45 @@',
  ...Array.from({ length: 40 }, (_, index) => ` line ${index + 1}, above the hunk`),
  ...SPECIMEN_DIFF.split('\n').slice(1),
].join('\n')

/** A named specimen, so what a part is called sits next to what it looks like. */
function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.62rem] text-muted-foreground">{name}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

/**
 * Every part the app is drawn from, in every variant and every state, on one
 * page — under the theme switcher, because a colour that fails is a colour that
 * fails in one of nine palettes and nowhere else.
 *
 * It is not linked from the interface: it is a workbench, reached at `/kit` by
 * whoever is changing the kit. What it earns its place for is the pass after a
 * change — a button whose disabled state went missing, a badge that lost its
 * contrast in the light themes, a popover that stopped clearing its own edge.
 */
export function KitScreen() {
  const [chosen, setChosen] = useState('medium')
  const [open, setOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [text, setText] = useState('')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Workbench"
        title="The kit"
        description="Every part, every variant, every state. Change one in src/ui and it changes here and everywhere at once — which is the point."
      />

      <Section
        eyebrow="Verbs"
        title="Buttons"
        description="Five weights and the quiet one in the colour of what it undoes. Pending disables the button and swaps its label; disabled is the same shape at 38%."
      >
        <Specimen name="variants">
          <Row>
            {BUTTONS.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </Row>
        </Specimen>

        <Specimen name="disabled">
          <Row>
            {BUTTONS.map((variant) => (
              <Button key={variant} variant={variant} disabled>
                {variant}
              </Button>
            ))}
          </Row>
        </Specimen>

        <Specimen name="pending">
          <Row>
            <Button variant="primary" pending pendingLabel="Saving…">
              Save
            </Button>
            <Button pending pendingLabel="Revoking…">
              Revoke
            </Button>
          </Row>
        </Specimen>

        <Specimen name="ButtonLink · TextButton · QuietLink · InlineLink">
          <Row>
            <ButtonLink href="/kit">Launch task</ButtonLink>
            <TextButton>read the whole thing →</TextButton>
            <QuietLink href="/kit">open on Docs ↗</QuietLink>
            <InlineLink href="/kit">a task by name</InlineLink>
          </Row>
        </Specimen>

        <Specimen name="icon-button · a verb that sits over what it acts on">
          <Row>
            <IconButton label="Show the whole edit">
              <Icon name="unfold" />
            </IconButton>
            <IconButton label="Clamp the edit back">
              <Icon name="fold" />
            </IconButton>
            <IconButton label="Open the file's diff">
              <Icon name="expand" />
            </IconButton>
          </Row>
        </Specimen>
      </Section>

      <Section
        eyebrow="Choices"
        title="Chips and badges"
        description="A chip is something to pick and reads its state off ARIA. A badge is a fact worn as a word — a tone, never a hue, so each theme decides what parked looks like."
      >
        <Specimen name="chip">
          <Row>
            <Chip>plain</Chip>
            <Chip pressed>pressed</Chip>
            <Chip expanded>expanded</Chip>
            <Chip disabled>disabled</Chip>
          </Row>
        </Specimen>

        <Specimen name="badge">
          <Row>
            {BADGES.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </Row>
        </Specimen>

        {/* The five signals together, which is the one place in the app they are
            allowed to appear together. Everywhere else, at most one is lit — two
            of them breathe, and one of those wears the halo as well, which is
            the whole of the app's motion and the whole of its emphasis. */}
        <Specimen name="signal · dot and name">
          <Row>
            {SIGNALS.map((signal) => (
              <span key={signal} className="flex items-center gap-2.5">
                <Dot
                  className={signalDot(signal)}
                  live={signalBreathes(signal)}
                  halo={signal === 'asking'}
                />
                <span className={cn('font-mono text-[0.72rem]', signalText(signal))}>{signal}</span>
              </span>
            ))}
          </Row>
        </Specimen>
      </Section>

      <Section
        eyebrow="Waiting"
        title="Arrival"
        description="A panel that fills while somebody is typing beside it has two jobs: hold its shape before it has anything, and not blank what is already true while it fetches what is newer."
      >
        <Specimen name="skeleton">
          <div className="max-w-sm space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Specimen>

        <Specimen name="reveal · reveal refreshing">
          <Row>
            <Reveal className="max-w-[12rem]">
              <Note size="xs">Settles in when it arrives.</Note>
            </Reveal>
            <Reveal refreshing className="max-w-[12rem]">
              <Note size="xs">Still true, just not the newest answer.</Note>
            </Reveal>
          </Row>
        </Specimen>
      </Section>

      <Section
        eyebrow="Voice"
        title="Type"
        description="Four registers and no others: the page's name, a section's, the eyebrow over either, and the quiet sentence under them."
      >
        <Specimen name="micro-label">
          <Row>
            {TONES.map((tone) => (
              <MicroLabel key={tone} tone={tone}>
                {tone}
              </MicroLabel>
            ))}
          </Row>
        </Specimen>

        <Specimen name="note">
          <Note>A sentence in the quiet voice — a description, a wait, an absence.</Note>
          <Note size="xs" className="mt-1">
            The same voice a size down, for a fact under a control.
          </Note>
        </Specimen>

        <Specimen name="error-note">
          <ErrorNote>A suite at a path needs the path it lives at.</ErrorNote>
        </Specimen>
      </Section>

      <Section
        eyebrow="Marks"
        title="Icons"
        description="One set at one weight, addressed by what a mark means here rather than by what the library calls it — which is why ui/icon.tsx is the only file that knows the set is lucide. The stroke is pinned in px rather than scaled with the box, so the chevron in a chip and the gear in the sidebar are drawn by the same hand."
      >
        <Specimen name="the set">
          <Row>
            {ICON_NAMES.map((name) => (
              <span key={name} className="flex items-center gap-1.5">
                <Icon name={name} />
                <span className="font-mono text-[0.62rem] text-muted-foreground">{name}</span>
              </span>
            ))}
          </Row>
        </Specimen>

        <Specimen name="sizes">
          <Row>
            {ICON_SIZES.map((size) => (
              <span key={size} className="flex items-center gap-1.5">
                <Icon name="settings" size={size} />
                <span className="font-mono text-[0.62rem] text-muted-foreground">{size}</span>
              </span>
            ))}
          </Row>
        </Specimen>

        <Specimen name="beside a word, in the parts that carry one">
          <Row>
            <Button variant="ghost">
              <Icon name="close" size="xs" />
              close
            </Button>
            <Chip>
              <Icon name="repo" size="xs" />
              specmate
            </Chip>
            <Chip expanded>
              pick one
              <Icon name="chevron-down" size="xs" className="rotate-180" />
            </Chip>
          </Row>
        </Specimen>
      </Section>

      <Section
        eyebrow="Input"
        title="Fields"
        description="A label, an optional sentence, the control, and the error — one rhythm, and the control finds its own label, invalid flag and description without the call site wiring four attributes."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repository URL" hint="Empty means the default branch.">
            <Input mono placeholder="https://github.com/org/repository" />
          </Field>

          <Field label="Convention">
            <Select defaultValue="openspec">
              <SelectOption value="openspec">OpenSpec</SelectOption>
              <SelectOption value="custom">A suite at a path</SelectOption>
            </Select>
          </Field>

          <Field label="Suite path" error="A suite at a path needs the path it lives at.">
            <Input mono defaultValue="" />
          </Field>

          <Field label="What governs it">
            <Textarea rows={2} placeholder="Numbered requirements, one file per service." />
          </Field>
        </div>

        <Specimen name="field-label, for a group rather than one control">
          <FieldLabel>Override models for this task</FieldLabel>
        </Specimen>
      </Section>

      <Section
        eyebrow="Surfaces"
        title="Panels and rows"
        description="One surface with its own inset, one step in from it, and the two row shapes — a settled fact with a way to undo it, and a rail row that selects."
      >
        <Panel as="div">
          <Note size="xs">panel</Note>
          <Subpanel className="mt-3">
            <Note size="xs">subpanel</Note>
          </Subpanel>
        </Panel>

        <PanelLink href="/kit" className="group block transition-colors hover:border-border-strong">
          <Note size="xs">panel-link — a panel that goes somewhere</Note>
        </PanelLink>

        <ul className="space-y-3">
          <ListRow
            primary={
              <p className="break-all font-mono text-xs text-muted-foreground">
                github.com/example/api
              </p>
            }
            secondary={
              <Note size="xs" className="mt-1">
                A suite at a path · docs/spec
              </Note>
            }
            action={<Button>Use detection</Button>}
          />
        </ul>

        <div className="p-[var(--rail-gutter)] rounded-xl border border-border">
          <NavRow href="/kit" active className="flex items-center gap-2.5">
            <Dot className="bg-status-active" />
            <span className="text-[0.82rem]">selected row</span>
          </NavRow>
          <NavRow href="/kit" active={false} className="flex items-center gap-2.5">
            <Dot className="bg-muted-foreground" />
            <span className="text-[0.82rem]">a row at rest</span>
          </NavRow>
        </div>
      </Section>

      <Section
        eyebrow="Over the page"
        title="Popovers and hints"
        description="One box, one width, one way in and two ways out — click past it or press Escape. A hint is the same surface, placed against the pointer rather than against a control."
      >
        <Row>
          <Popover
            open={open}
            onDismiss={() => setOpen(false)}
            side="bottom"
            padding="menu"
            role="menu"
            label="A menu"
            trigger={
              <Chip expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
                open a menu
                <Icon name="chevron-down" size="xs" />
              </Chip>
            }
          >
            {['small', 'medium', 'large'].map((size) => (
              <button
                key={size}
                type="button"
                role="menuitemradio"
                aria-checked={size === chosen}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.06]"
                onClick={() => {
                  setChosen(size)
                  setOpen(false)
                }}
              >
                <span className="font-mono text-[0.78rem]">{size}</span>
                {size === chosen && <Icon name="check" />}
              </button>
            ))}
          </Popover>

          <HoverHint hint="What the row has no width to say — the model, the attempts, what it spent.">
            <Chip>rest the pointer here</Chip>
          </HoverHint>
        </Row>
      </Section>

      <Section
        eyebrow="Where the owner speaks"
        title="Console"
        description="The one input, in each of the moods it can be in. The accent is the state's; the frame and the field never change."
      >
        <Console tone="asking" onSubmit={(event) => event.preventDefault()}>
          <p className="flex items-baseline gap-2 px-4 pt-3 font-mono text-[0.72rem] text-muted-foreground">
            <Dot className="self-center bg-warning" />
            <span>kickoff · question 1 of 2</span>
          </p>
          <div className="px-4 pb-1 pt-3">
            <ConsoleField
              rows={1}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder="Answer, or say what to do instead…"
              aria-label="Answer"
            />
          </div>
          <div className="flex items-center gap-1 px-4 pb-3 pt-1">
            <Button variant="ghost-destructive">
              <Icon name="stop" size="xs" className="fill-current" />
              Stop
            </Button>
            <span className="flex-1" />
            <Button variant="warning" type="submit" className="min-h-9 py-1.5">
              Answer
            </Button>
          </div>
        </Console>
      </Section>

      <Section
        eyebrow="A number, drawn"
        title="Gauges and ticks"
        description="Three parts a stack of files needs and nothing else does: how far a pass has got, how a file's change divides, and a tick that belongs to the palette rather than to the browser."
      >
        <Specimen name="Meter">
          <div className="space-y-2">
            <Meter done={0} total={7} label="None viewed" className="w-40" />
            <Meter done={3} total={7} label="Three of seven viewed" className="w-40" />
            <Meter done={7} total={7} label="All viewed" className="w-40" />
          </div>
        </Specimen>

        <Specimen name="StatBar">
          <div className="space-y-2 font-mono text-xs">
            <p className="flex items-center gap-2">
              <StatBar additions={40} deletions={0} /> only added
            </p>
            <p className="flex items-center gap-2">
              <StatBar additions={0} deletions={40} /> only removed
            </p>
            <p className="flex items-center gap-2">
              <StatBar additions={180} deletions={20} /> mostly added
            </p>
            <p className="flex items-center gap-2">
              <StatBar additions={400} deletions={1} /> one line lost of 401
            </p>
          </div>
        </Specimen>

        <Specimen name="Checkbox">
          <div className="flex items-center gap-5">
            <Checkbox label="Viewed" defaultChecked={false} />
            <Checkbox label="Viewed" defaultChecked />
            <Checkbox label="Viewed" disabled />
            <Checkbox label="Viewed" defaultChecked disabled />
          </div>
        </Specimen>

        <Specimen name="FolderName">
          <div>
            <MicroLabel>Specification · 4</MicroLabel>
            <FolderName>openspec/changes/files-review-surface</FolderName>
            <FolderName className="ps-3">specs/operator-ui</FolderName>
          </div>
        </Specimen>
      </Section>

      <Section
        eyebrow="What a run changed"
        title="Diffs"
        description="One face, two readings: a whole file is read as prose, and an edit inside a record is read by line, so the gutter is a choice rather than a second stylesheet. Given the file's path it reads the language too — five hues, and everything else in the reading colour."
      >
        <Specimen name="Diff · coloured by the language its path names">
          <Diff diff={SPECIMEN_CODE_DIFF} path="src/lib/task-thread.ts" lineNumbers />
        </Specimen>

        <Specimen name="Diff · coloured, split">
          <Diff diff={SPECIMEN_CODE_DIFF} path="src/lib/task-thread.ts" view="split" lineNumbers />
        </Specimen>

        <Specimen name="Diff">
          <Diff diff={SPECIMEN_DIFF} />
        </Specimen>

        <Specimen name="Diff · lineNumbers">
          <Diff diff={SPECIMEN_DIFF} lineNumbers />
        </Specimen>

        <Specimen name="Diff · split">
          <Diff diff={SPECIMEN_DIFF} view="split" lineNumbers />
        </Specimen>

        <Specimen name="Diff · a hunk that opens">
          <Diff diff={SPECIMEN_DIFF} wholeFile={SPECIMEN_WHOLE_FILE} lineNumbers />
        </Specimen>

        <Specimen name="Diff · a hunk that opens, split">
          <Diff diff={SPECIMEN_DIFF} wholeFile={SPECIMEN_WHOLE_FILE} view="split" lineNumbers />
        </Specimen>

        <Specimen name="Diff · nothing to show">
          <Diff diff="" />
        </Specimen>
      </Section>

      <Section
        eyebrow="Over the page, at its own scale"
        title="Drawer"
        description="A surface that opens over the one being read rather than instead of it. The same two ways out as a popover, anchored to the viewport rather than to a control, because what opens one is a file named halfway down a record."
      >
        <Row>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            open a drawer
          </Button>
        </Row>

        <Drawer
          open={drawer}
          onDismiss={() => setDrawer(false)}
          label="File diff"
          detail={
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              openspec/changes/pie-chart-axis-fade/proposal.md
            </p>
          }
        >
          <div className="min-w-0 p-4 sm:p-6">
            <Diff diff={SPECIMEN_DIFF} lineNumbers />
          </div>
        </Drawer>
      </Section>

      <Section
        eyebrow="On its way"
        title="Waiting"
        description="A pane waits in the shape of its own answer, so nothing moves when the answer lands and the wait says what is coming as well as that something is. The slots sweep rather than breathe: the breath belongs to what is alive, and a slot is an absence."
      >
        <Specimen name="LoadingState · sentence, for a pane with no shape worth guessing">
          <LoadingState title="Loading model defaults…" />
        </Specimen>

        <Specimen name="LoadingState · rows">
          <LoadingState title="Computing the task's diff…" shape="rows" />
        </Specimen>

        <Specimen name="LoadingState · cards">
          <LoadingState title="Scanning the attention channel…" shape="cards" />
        </Specimen>

        <Specimen name="LoadingState · document">
          <LoadingState title="Loading task channel…" shape="document" />
        </Specimen>

        <Specimen name="LoadingState · code">
          <LoadingState title="Loading diff…" shape="code" />
        </Specimen>

        <Specimen name="SkeletonRows · mark, as the sidebar waits">
          <div className="p-[var(--rail-gutter)] rounded-xl border border-border">
            <SkeletonRows rows={3} mark />
          </div>
        </Specimen>

        <Specimen name="SkeletonFacts">
          <SkeletonFacts rows={2} />
        </Specimen>

        <Specimen name="Skeleton · SkeletonText">
          <Skeleton className="h-3 w-40" />
          <SkeletonText lines={3} className="mt-4" />
        </Specimen>

        <Specimen name="Working — a wait too small for a shape">
          <p className="font-mono text-xs text-muted-foreground">
            <Working>loading the whole edit…</Working>
          </p>
        </Specimen>
      </Section>

      <Section
        eyebrow="Nothing, and nothing that will come"
        title="Query states"
        description="A request that will not be answered, and a pane with nothing in it — each at the size the answer would have taken."
      >
        <ErrorState title="Model defaults unavailable" detail="The server answered 503." />
        <Panel as="div" flush>
          <EmptyState>No product-code changes have been committed yet.</EmptyState>
        </Panel>
      </Section>

      <ThemeSection />
    </div>
  )
}
