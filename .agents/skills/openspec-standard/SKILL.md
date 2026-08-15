---
name: openspec-standard
description: House discipline for writing OpenSpec spec files — living specs and change deltas. Stable banded IDs carried in requirement titles (REQ-n, INV-n), acceptance IDs in scenario titles (AC-n), cross-referencing by ID only, RENAMED semantics that keep IDs immutable, and the lint rules that keep references checkable. Use when writing or reviewing any openspec/ spec.md or delta spec in any repo, and when deciding how to reference a specific requirement, scenario, or decision from another document.
---

# OpenSpec standard

How OpenSpec-shaped normative text is written in our repos. OpenSpec itself has no
reference system: a requirement's identity is the literal text of its `### Requirement:`
header (delta operations match on it), and the CLI's `-r <n>` is a 1-based positional
index that shifts on every insertion. Anchors and positions are therefore never the
contract. Our IDs are — these rules say how they attach.

The deeper normative core — implementation-free text, symbolic `P-*` parameters,
testability, append-only ADRs, the full ID band catalog — is defined by the
**product-tech-spec** skill ("Non-negotiable principles"). This skill binds that core to
OpenSpec's file format and scopes it to everyday spec writing; it does not restate it.

## Rules

1. **The ID lives in the title.** Every requirement header carries its stable ID before
   the prose: `### Requirement: REQ-12 — Ordered, exactly-once block streaming`. The ID
   is immutable forever; the prose after the dash may change. Because delta matching keys
   on the full header, a prose change is always an explicit `RENAMED` operation
   (`FROM:`/`TO:`), never a silent edit — the ID survives as the greppable anchor on both
   sides.

2. **Scenarios carry acceptance IDs where traceability is wanted.** `#### Scenario: AC-3
   — <name>`. The scenario→test mapping (conformance matrix, mechanical traceability
   checks) keys on the `AC` ID, not on the scenario's prose or position.

3. **Cross-reference by ID only.** In normative text, references are bare IDs: "violates
   INV-3", "see REQ-12", "per ADR-007". A markdown anchor link may *accompany* an ID for
   navigation, but the ID is the contract — anchors break silently when a heading is
   renamed and no tool validates them.

4. **Positions are never references.** Neither a CLI index nor "the third requirement"
   may appear in any document or finding; both shift on insertion.

5. **IDs are unique across the suite, regardless of file layout.** Requirement bands may
   map to capabilities, and cross-cutting catalogs (INV/LIV/FM/OB/…) may be capabilities
   of their own — splitting or regrouping files never renumbers and never reuses an ID.
   Gaps stay reserved.

6. **Decisions are changes; the ADR log is append-only.** New decisions are born as
   OpenSpec changes; the archived change is canonical and a generated one-page ADR is
   committed to the repo's append-only `openspec/decisions/`, continuing the numbering of
   any hand-written predecessors. An ADR file is never edited, only superseded.

7. **Lint one source against a ruler.** The checkable properties are: every referenced ID
   exists (no dangling references), and no ID is defined twice. External documents that
   point into a suite (a cross-service map, an ADR, a review finding) are held to the same
   dangling-ID check. What is never acceptable is two normative sources reconciled against
   each other — one canonical spec, references everywhere else.
