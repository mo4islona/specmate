## ADDED Requirements

### Requirement: REQ-1707 — A task writes into a repository only what its convention asks for

A task SHALL write into its target repository's tree only what that repository's own specification
convention asks for. Where the profile in force is an OpenSpec suite, the change folder is that
repository's own convention and SHALL be created in its tree and carried by the task's commits.
Under every other profile the change folder SHALL NOT appear in the repository's tree: the task's
artifacts SHALL be written where commits do not reach them, and SHALL be readable to the owner and
to every later stage on the same terms as artifacts a repository does carry.

Under a profile naming a suite in another shape, the change's own specification SHALL still be
produced on the terms REQ-1706 sets. What the task MUST NOT do is file that specification in the
repository under a convention the repository does not use — grounding the change in the suite that
exists (REQ-1704) and writing a second suite beside it are opposites.

What follows from a profile SHALL be stated in one place: whether the repository keeps the change
folder, where that folder stands, whether the specification segment runs, and what a role that
writes or judges a specification is given as the convention to follow. A caller SHALL read those
from that one statement rather than deciding them from the profile itself.

Where a task's artifacts live SHALL be decided once, when the task is first provisioned, and SHALL
NOT move afterwards. A profile the owner changes while a task is running governs what the task does
next (REQ-1706); it MUST NOT relocate artifacts already written, nor leave one task's work filed
under two locations.

#### Scenario: AC-1721 — An OpenSpec repository

- **WHEN** a task runs against a repository whose profile in force is an OpenSpec suite
- **THEN** its change folder SHALL be created in the repository's tree and carried by the task's commits

#### Scenario: AC-1722 — A repository with no suite

- **WHEN** a task runs against a repository whose profile in force is none
- **THEN** no change folder SHALL appear in the repository's tree, and the task's branch SHALL carry product code alone

#### Scenario: AC-1723 — A suite in another shape

- **WHEN** a task runs against a repository whose profile names a suite at a configured location
- **THEN** the change's specification SHALL still be produced and readable, and SHALL NOT be written into the repository's tree

#### Scenario: AC-1724 — The profile changes while the task runs

- **WHEN** the owner changes a repository's profile after a task has been provisioned
- **THEN** that task's artifacts SHALL stay where they were first written, and no artifact SHALL be filed a second time under another location

#### Scenario: AC-1725 — One statement of what a profile decides

- **WHEN** a caller needs to know what a profile implies about the repository, the pipeline, or the standard a role is given
- **THEN** it SHALL read the profile's implementation, and the answers SHALL agree with one another because they come from it
