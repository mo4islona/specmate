## ADDED Requirements

### Requirement: REQ-1019 — What a request would resolve to is readable without creating anything

The API SHALL accept an authenticated read carrying the text of a request, and optionally a
repository the caller has chosen, and answer what an intake of that same text would resolve to:
the target repository, the rule that resolved it, and — where nothing resolved, or where more than
one candidate matched — the candidates, in the same form a rejected intake carries them. It SHALL
also carry the repository and issue references the text names, parsed and unfetched, each saying
whether it was written as a link or inferred from shorthand.

The answer SHALL be produced by the same resolution intake performs (REQ-1016). Resolution SHALL
remain mechanical: no agent run and no reading of the request's meaning stand between the caller
and the answer.

This read SHALL create nothing. No task, no event, and no durable record of any kind SHALL result
from it, and it SHALL be safe to call repeatedly as a request is being written.

#### Scenario: AC-1062 — A request that resolves

- **WHEN** a preview carries request text naming a repository
- **THEN** the response SHALL name that repository and the rule that resolved it

#### Scenario: AC-1063 — A request that does not resolve

- **WHEN** a preview carries request text matching two known repositories, or matching none with no default set
- **THEN** the response SHALL report that it did not resolve and SHALL carry the candidates, exactly as a rejected intake would

#### Scenario: AC-1064 — The preview creates nothing

- **WHEN** a preview is called any number of times
- **THEN** no task, event, or other durable record SHALL exist as a result

#### Scenario: AC-1065 — The preview and the launch agree

- **WHEN** a preview and a create request carry the same request text and the same chosen repository
- **THEN** the repository the preview names SHALL be the repository the created task is against

### Requirement: REQ-1020 — One repository, and what the system holds about it

The API SHALL expose a single repository by the identity the repository list already gives it,
carrying what that list carries for it — how many tasks have run against it, when it was last
used, whether it is the default, and the coverage waiver in force — together with the
specification convention setting in force for it, the tasks most recently run against it, and a
bounded, most-recent-first excerpt of what that repository remembers, with the total number of
entries alongside the excerpt.

The specification convention SHALL be carried as two things and never as one: what the owner set,
which is an instruction, and what a real checkout resolved on the most recent task that ran, which
is what actually governed a run. Where no task has resolved one, that half SHALL be absent rather
than filled in from the setting.

A repository the system has never run a task against has no such identity and SHALL be reported as
unknown rather than as an error in reading it; what a caller knows about such a repository is what
it named in the request.

#### Scenario: AC-1066 — Reading a repository the system knows

- **WHEN** a repository with tasks, a spec convention setting, and remembered entries is read
- **THEN** the response SHALL carry its counts, the convention in force, the coverage waiver if any, its most recent tasks, and an excerpt of what it remembers with the total

#### Scenario: AC-1074 — The convention a task actually ran under

- **WHEN** a repository is read whose most recent task resolved a specification convention against a real checkout
- **THEN** that resolved convention SHALL be carried alongside the owner's setting, distinguishable from it

#### Scenario: AC-1067 — A repository with no history

- **WHEN** a repository the system holds nothing about is read
- **THEN** the response SHALL say so plainly rather than fail

#### Scenario: AC-1068 — An identity that names nothing

- **WHEN** a read names an identity no repository has
- **THEN** the API SHALL respond with a structured error

### Requirement: REQ-1022 — What governs a repository with no history here is determined, not deferred

The API SHALL determine, for a repository the system has run no task against, what a task launched
against it would run under: the repository's default branch, and which of the paths its
specification convention setting expects are actually in its tree. The determination SHALL be
mechanical — a lookup on the forge, with no clone and no agent run — and SHALL produce the
convention through the same rules provisioning applies (REQ-1702), so a forecast and what a task
ends up running under can differ only in when they were taken, never in how they were decided.

A path lookup that could not be performed MUST NOT be recorded as a path that is absent: a
repository whose tree could not be read SHALL be reported as undetermined, never as one with no
specification. Where the repository cannot be read at all — no credential, a host the system does
not read, a repository the credential cannot see — the API SHALL say so and MUST NOT fail the
caller's request, and nothing about launching a task SHALL depend on it.

Repeated determinations of one repository within a short window SHALL be answered without
repeating the outbound lookups.

#### Scenario: AC-1075 — A repository carrying a specification suite

- **WHEN** a repository with no history here is determined and its tree holds the suite its setting expects
- **THEN** the response SHALL carry its default branch and the convention resolved from that tree

#### Scenario: AC-1076 — A repository carrying none

- **WHEN** the tree holds no suite
- **THEN** the convention SHALL resolve to none, which is an answer rather than an absence of one

#### Scenario: AC-1077 — The tree could not be read

- **WHEN** the repository cannot be read, for any reason
- **THEN** the response SHALL report it as undetermined with the reason, SHALL NOT be an error, and MUST NOT state that the repository has no specification

#### Scenario: AC-1078 — A host the system does not read

- **WHEN** the repository is on a host the system does not read
- **THEN** it SHALL be reported as undetermined and no outbound request SHALL be made

### Requirement: REQ-1021 — A GitHub reference is readable, and a missing credential degrades rather than fails

The API SHALL expose what a GitHub issue or pull request reference points at — its number, title,
state, labels and author — read under the GitHub credential the system already stores. The read
SHALL be addressed by the reference alone: the host, the owner, the repository and the number, and
nothing else. A reference naming a host the system does not read SHALL be reported as unreadable
without any request leaving the system.

Where the credential is absent, expired, or refuses the reference — and where the reference does
not exist, or the rate limit is reached — the API SHALL answer that the reference could not be
read, with a reason fit to show, and MUST NOT fail the caller's request. Nothing about launching a
task SHALL depend on this read succeeding.

Repeated reads of one reference within a short window SHALL be answered without repeating the
outbound request, so that writing about one issue costs one lookup.

#### Scenario: AC-1069 — Reading an issue

- **WHEN** a reference naming an existing issue is read with a valid credential
- **THEN** the response SHALL carry its number, title, state, labels and author

#### Scenario: AC-1070 — No credential stored

- **WHEN** a reference is read with no GitHub credential stored
- **THEN** the response SHALL report the reference as unreadable with the reason, and SHALL NOT be an error

#### Scenario: AC-1071 — The reference cannot be reached

- **WHEN** the reference does not exist, is not visible to the stored credential, or the rate limit is reached
- **THEN** the response SHALL report it as unreadable with the reason, and SHALL NOT be an error

#### Scenario: AC-1072 — The same reference read repeatedly

- **WHEN** one reference is read several times within a short window
- **THEN** the outbound request SHALL be made once and the later reads SHALL be answered from what it returned

#### Scenario: AC-1073 — A host the system does not read

- **WHEN** a reference names a host other than GitHub
- **THEN** it SHALL be reported as unreadable and no outbound request SHALL be made
