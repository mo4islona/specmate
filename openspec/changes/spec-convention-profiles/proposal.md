## Why

SpecMate never reads the specification a repository already has. The change folder is scaffolded
by provisioning (`packages/workspace/src/manager.ts`), the planner writes `proposal.md`,
`design.md` and `specs/**/spec.md` into it, and the reviewer and validator read them back out. The
prompt is assembled from four sources and no others — role prompt, change-folder artifacts,
ledger, product-code diff (`packages/runner/src/prompt.ts`). Nowhere does anything look for a
living spec suite, in any format.

That was invisible while SpecMate ran only against itself, because a task against this repository
produced a change folder under the same `openspec/` root the repository already used, and the
resemblance passed for integration. It does not survive being pointed at other repositories. Three
kinds now exist: one with a living OpenSpec suite, one with a suite in a different shape — a
product-tech-spec document set — and one with no specification at all. All three get identical
treatment: the repository is read as code, and the change's specification is written free-standing,
naming no requirement that already governs the area it changes.

The consequence in an OpenSpec repository is the sharp one. The planner writes a specification
that ought to be a delta — requirements it modifies, IDs it extends — and instead writes prose
that restates behaviour already specified elsewhere, under IDs nobody allocated. Two normative
sources then describe the same behaviour and have to be reconciled by hand, which is the exact
failure the spec standard exists to prevent.

The tempting reading of the same problem is that a repository without a specification is the
exception, and the specifying stage should be skipped there. That is backwards. `specify` produces
the specification; it consumes nothing. Skipping it would empty the specification gate, and would
strand validation — the validator builds its scenario inventory from the change's `specs/**/spec.md`
and holds an approve verdict to covering every one of them, so with no specification an approve
becomes unconditional. REQ-602 already forbids it: specification is on the spine, and no profile
may omit a spine stage.

What actually varies between repositories is not whether a specification exists but which
convention governs it. This change makes that a property SpecMate knows.

**Roadmap.** Phase 2's context-sources thread (§4 "Context sources", §14 Phase 2) — the same thread
the harness probe belongs to, and it reuses that mechanism: a repository-scoped property assessed
once, carried to every stage through the ledger, and overridable by the owner.

## What Changes

- A repository gains a **spec convention profile**: `openspec`, `custom`, or `none`. It says where
  the repository's living specification lives and which convention governs it — not whether the
  pipeline runs a specifying stage, which it always does.
- Provisioning **detects** the profile from the checked-out tree: an OpenSpec root resolves to
  `openspec`, anything else to `none`. `custom` is never detected, only configured.
- The owner can **override** detection per repository in Settings, and configure the suite's path
  and a short convention note for `custom`. The override is repository-scoped and survives tasks,
  the way an accepted coverage gap does (REQ-1406).
- The profile reaches an agent as a **ledger line**, next to `Harness coverage`. The ledger says
  where the suite is and under what convention; the planner reads the files themselves with its
  own tools, as it already reads code. No specification text enters the prompt, so the four
  sources REQ-102 fixes are unchanged.
- The planner **grounds in the suite** where one exists: at `planning` it names the requirements the
  request touches by ID, and at `specify` it writes the change's specification as a delta against
  those IDs. Under `none` its behaviour is exactly what ships today.
- Nothing about the pipeline's shape changes. `specify` stays on the spine under every profile.

## Capabilities

### New Capabilities
- `spec-conventions`: how SpecMate learns which specification convention a repository follows, how
  that reaches a stage, and what a role does with it — including the guarantee that a repository
  with no specification still runs the specifying stage.

### Modified Capabilities
- `operator-ui`: a new Settings section for the per-repository profile — the growth REQ-917 was
  built for.

## Non-goals

- **No writeback into the repository's living suite.** Syncing an archived change's delta into
  `openspec/specs/**` is OpenSpec's own `archive`, and SpecMate does not run it. The change folder
  remains the only place SpecMate writes specification text.
- **No reading of the suite by the reviewer, validator or implementer.** Only the planner grounds
  in it. Widening that is a later change, and should be argued from evidence that the planner's
  grounding was not enough.
- **No auto-detection of `custom` layouts.** Guessing where an arbitrary document set lives, and
  what its identifiers mean, is a research problem. The owner points at it.
- **No repository convention files.** SpecMate still adds nothing to a repository but the change
  folder — REQ-705's AC-716 stands unchanged.
- **No new pipeline node, and no conditional on an existing one.** The profile is context, not
  control flow.

## Impact

- `packages/workspace` — detection during provisioning; the profile becomes part of the provisioned
  `Workspace`. `WorkspaceConfig.changeSchema` is today a global constant written into the change
  folder's marker and read nowhere; it is the seam the profile replaces.
- `packages/runner` — one `## Task` line in the rendered ledger.
- `packages/db` — a repository-scoped settings row, alongside the coverage-waiver table that is
  already keyed by repository URL.
- `apps/orchestrator` — resolving override-over-detection when a stage is dispatched.
- `apps/api`, `apps/web` — read and write the setting; one Settings section.
- `roles/planner.md` — what to do at each profile.
