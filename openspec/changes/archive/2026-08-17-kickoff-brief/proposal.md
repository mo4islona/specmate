## Why

A SpecMate task cannot start today. The feature/bugfix pipeline opens with `planning` →
`kickoff_brief` → `human_kickoff_gate`, the `planner` role sits in the catalog with its
provider binding and its container-runtime posture already derived — and `roles/planner.md`
does not exist, so the first stage of every task fails with a missing prompt file. The archived
orchestrator-loop change said so in as many words: the planning segment fails loudly until the
kickoff-brief change writes the prompt, and until then tasks are started at research by hand.

Two more things are missing behind that prompt. The planner's role contract reads *nothing* —
so the brief stage cannot see what planning wrote, and a regenerating planner cannot see why
the owner rejected the last brief. And a task carries only a 200-character title: a task is
meant to be described in natural language, but there is nowhere to put the description, so the
planner would be briefing on a headline.

This is the phase's cheapest correction point: aligning on intent before research runs costs
one page and one click, and every misunderstanding caught here is a research⇄review loop not
spent. It is also the first stage where the owner's own words enter
the system, which makes it the front door of the self-learning flywheel.

## What Changes

- **The task carries the ask.** Intake accepts the owner's request as free text alongside the
  title, it is stored on the task, and it reaches every stage through the ledger. When none is
  given the title is the ask — no forced migration of the existing contract.
- **`roles/planner.md`, and a planner that can read.** The role's contract gains the proposal
  and the decision log among the artifacts it reads, so the brief stage sees the draft it is
  refining and a regenerating planner sees the answers and comments that rejected the last
  brief.
- **The two planner nodes get distinct jobs.** `planning` reads the repository and grounds the
  brief in it — what the request means in this codebase, where the work lands, what is risky —
  and refuses to invent a brief for a request it cannot place at all. `kickoff_brief` does not
  re-read the repository: it turns the draft into the one page the owner acts on, sharpens the
  key points, finalizes the questions, and sizes the work.
- **The brief's shape is a contract, checked mechanically.** What it must carry — what and why,
  the approach in a handful of bullets, a key-points block naming risk and blast radius, the
  open questions or an explicit statement that there are none, a rough size with the expected
  iteration budget — is checked after a planner run, before anything is committed, exactly like
  the write-scope check that already runs there. The check judges presence and explicitness,
  never quality: persuasion is the gate's business.
- **Open questions are non-blocking decisions answered on the card.** They do not park the task
  short of its gate; they travel with the brief, the owner answers them in place, and approving
  the gate resolves every one — answers stay answers, unanswered ones become dismissals. Research
  never starts with a question from the brief still hanging.
- **A redirect regenerates for the reason it was rejected.** The owner's comment reaches the
  regenerating planner through the ledger, and a spent regeneration cap refuses further
  redirects while leaving approve and cancel available.
- **The gate shows the brief.** At the kickoff gate the task view renders the brief in place
  with its key points accented, rather than sending the owner to the artifacts screen to decide.

## Capabilities

### New Capabilities

- `kickoff-brief` (REQ-1301–REQ-1305): what planning must ground and what the brief must carry,
  the mechanical completeness check that keeps an incomplete brief away from the gate, how the
  brief's open questions are raised and resolved, and what a redirect carries back to the
  planner.

### Modified Capabilities

- `agent-execution`: REQ-202 — the ledger carries the owner's own words, both the request the
  task was launched with and the comments the owner left at a gate. Neither is an agent
  transcript, which the requirement still forbids.
- `persistence`: REQ-303 — a task records the request it was launched with.
- `task-surface`: REQ-1001 — intake accepts that request.
- `operator-ui`: REQ-903 — the new-task form collects it; REQ-913 — a task parked at its
  kickoff gate presents the brief where the gate actions are.

## Impact

- `packages/db`: one nullable text column on `tasks` — one migration, no backfill.
- `packages/core`: the planner's role contract learns to read the proposal and the decision
  log, and gains the declaration that its proposal output is checked for completeness; the
  brief check itself is a pure function over markdown.
- `packages/runner`: the completeness check joins the existing post-run write-scope check,
  before the commit; the ledger renders the ask and the owner's gate comments.
- `roles/planner.md`: new — the prompt for both planner nodes, stating which of them is
  grounding and which is presenting.
- `apps/api` / `apps/web`: one field through intake and the form; the brief rendered at the
  kickoff gate.
- Ordering: this change depends on `decision-records` for non-blocking decisions, contextual
  discussion, and dismissal (REQ-1202, REQ-1206, REQ-1207) — REQ-1304 is written against that
  text and cannot be implemented before it. This transitively follows `task-qa`. Its
  `persistence` delta touches REQ-303, which neither `decision-records` (REQ-307) nor `task-qa`
  (REQ-302/REQ-309/REQ-310/REQ-312) modifies; its `task-surface` delta touches REQ-1001, which
  neither changes.

## Non-goals

- **No harness probe.** Classifying the repository's harness coverage during planning, the
  mandatory warning it forces into the key points, and the task split are the next Phase-2
  change. This one leaves `harness_status` as it finds it.
- **No planner-set caps, budgets, or provider bindings.** Pipelines became data in the
  orchestrator-loop change and a task's graph is pinned from the catalog, so the planner
  parameterizes nothing here — the result contract has no channel for it. The brief states the
  expected iteration budget as prose the owner reads, not as a value the engine consumes.
- **No new pipeline nodes and no changes to the shipped definition.** The planning segment,
  the gate, and the redirect edge with its cap all exist; this change makes them runnable.
- **No brief for other task types.** The incident pipeline arrives in Phase 4 with its own
  intake stage; nothing here is written to be reused by it beyond the role prompt.
- **No editing of the brief by the owner.** Approve, redirect with a comment, or cancel — the
  three verdicts available at a gate. Editing the proposal in the browser is Phase 3's rework
  flow.
- **No quality bar on the brief.** The mechanical check counts parts, not merit; a shallow but
  complete brief reaches the gate and is the owner's to reject.
