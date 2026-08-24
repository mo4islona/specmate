import { type ReactNode, useState } from 'react'
import { ThemeSection } from '../components/theme-section.tsx'
import {
  Badge,
  type BadgeTone,
  Button,
  ButtonLink,
  type ButtonVariant,
  Chip,
  Console,
  ConsoleField,
  Dot,
  EmptyState,
  ErrorNote,
  ErrorState,
  Field,
  FieldLabel,
  HoverHint,
  InlineLink,
  Input,
  ListRow,
  LoadingState,
  MicroLabel,
  NavRow,
  Note,
  PageHeader,
  Panel,
  PanelLink,
  Popover,
  QuietLink,
  Section,
  Select,
  Subpanel,
  Textarea,
  TextButton,
  type Tone,
} from '../ui/index.ts'

const BUTTONS: readonly ButtonVariant[] = [
  'primary',
  'attention',
  'danger',
  'secondary',
  'ghost',
  'ghost-danger',
]

const BADGES: readonly BadgeTone[] = ['active', 'parked', 'failed', 'done', 'muted', 'warning']

const TONES: readonly Tone[] = ['muted', 'accent', 'info', 'attention', 'danger', 'success']

const DOTS = ['bg-status-active', 'bg-status-parked', 'bg-status-failed', 'bg-status-done'] as const

/** A named specimen, so what a part is called sits next to what it looks like. */
function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.62rem] text-muted">{name}</p>
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

        <Specimen name="dot">
          <Row>
            {DOTS.map((colour) => (
              <Dot key={colour} className={colour} />
            ))}
            <Dot className="bg-accent" live />
            <span className="font-mono text-[0.62rem] text-muted">last one is live</span>
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
              <option value="openspec">OpenSpec</option>
              <option value="custom">A suite at a path</option>
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

        <PanelLink href="/kit" className="group block transition-colors hover:border-accent/40">
          <Note size="xs">panel-link — a panel that goes somewhere</Note>
        </PanelLink>

        <ul className="space-y-3">
          <ListRow
            primary={
              <p className="break-all font-mono text-xs text-muted">github.com/example/api</p>
            }
            secondary={
              <Note size="xs" className="mt-1">
                A suite at a path · docs/spec
              </Note>
            }
            action={<Button>Use detection</Button>}
          />
        </ul>

        <div className="rail-inset rounded-xl border border-border">
          <NavRow href="/kit" active className="flex items-center gap-2.5">
            <Dot className="bg-status-active" />
            <span className="text-[0.82rem]">selected row</span>
          </NavRow>
          <NavRow href="/kit" active={false} className="flex items-center gap-2.5">
            <Dot className="bg-muted" />
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
                open a menu ⌄
              </Chip>
            }
          >
            {['small', 'medium', 'large'].map((size) => (
              <button
                key={size}
                type="button"
                role="menuitemradio"
                aria-checked={size === chosen}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-text/[0.06]"
                onClick={() => {
                  setChosen(size)
                  setOpen(false)
                }}
              >
                <span className="font-mono text-[0.78rem]">{size}</span>
                {size === chosen && <span aria-hidden="true">✓</span>}
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
          <p className="flex items-baseline gap-2 px-4 pt-3 font-mono text-[0.72rem] text-muted">
            <span className="text-attention" aria-hidden="true">
              ●
            </span>
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
            <Button variant="ghost-danger">■ Stop</Button>
            <span className="flex-1" />
            <Button variant="attention" type="submit" className="min-h-9 py-1.5">
              Answer
            </Button>
          </div>
        </Console>
      </Section>

      <Section
        eyebrow="Nothing, and nothing yet"
        title="Query states"
        description="A request waiting, a request that will not be answered, and a pane with nothing in it — each at the size the answer would have taken."
      >
        <LoadingState title="Loading model defaults…" />
        <ErrorState title="Model defaults unavailable" detail="The server answered 503." />
        <Panel as="div" flush>
          <EmptyState>No product-code changes have been committed yet.</EmptyState>
        </Panel>
      </Section>

      <ThemeSection />
    </div>
  )
}
