## MODIFIED Requirements

### Requirement: REQ-1001 — Task intake

The API SHALL accept a new task carrying the owner's request in free text, and optionally a
title, a task type from the catalog, a repository URL, a base branch, and a per-role model
and/or reasoning-effort override; resolve the target repository per REQ-1016 when the request
carried none; create the task in its initial state with its bindings resolved from that override
and the current model-defaults setting; and record its creation in the event log. The request
text SHALL be required — it is the only thing the pipeline works from — and intake carrying none
MUST be rejected. A title intake was not given SHALL be derived from the request text, and a
type it was not given SHALL be recorded provisionally; both stand until planning declares what
supersedes them (REQ-1306). A base branch intake was not given SHALL be left unset for
provisioning to resolve (REQ-703). Invalid intake MUST be rejected with a response naming every
offending field and MUST NOT create partial state.

#### Scenario: AC-1001 — Valid task submitted

- **WHEN** a create request carries the owner's request and a repository URL
- **THEN** the task SHALL exist in its initial state, a creation event SHALL be appended, and the response SHALL return the task with its identity

#### Scenario: AC-1002 — Invalid intake

- **WHEN** a create request omits the request text and carries an unknown task type
- **THEN** the API SHALL respond with a validation error naming both fields and no task or event SHALL be created

#### Scenario: AC-1026 — A task described in the owner's words

- **WHEN** a create request carries a multi-paragraph request
- **THEN** it SHALL be stored with the task intact and returned when the task is read

#### Scenario: AC-1038 — Launching with a model override

- **WHEN** a create request carries a model and/or reasoning-effort override for one role
- **THEN** the created task's stored bindings SHALL reflect that override for that role and the current defaults for every other role

#### Scenario: AC-1039 — Override names an unknown model or reasoning effort

- **WHEN** a create request's override names a model outside the known catalog, or a reasoning effort outside the known levels
- **THEN** intake SHALL reject it naming the offending field and no task SHALL be created

#### Scenario: AC-1056 — Launched with nothing but the request

- **WHEN** a create request carries only the owner's request and the repository resolves
- **THEN** the created task SHALL carry a title and a slug derived from that request, a type from the catalog, and no base branch of its own

## ADDED Requirements

### Requirement: REQ-1016 — Intake resolves the target repository, and asks only when it cannot

Intake SHALL determine the target repository without asking the owner to restate it, in a fixed
order: a repository URL carried by the create request; a repository URL written in the request
text; a repository the system already knows, named unambiguously in the request text; the
default-repository setting. Resolution SHALL be mechanical — no agent run and no reading of the
request's meaning stand between a create request and the task it creates. When no rule resolves,
or when more than one known repository matches the request text, intake MUST NOT choose: it SHALL
reject the create request naming the repository as the offending field, carry the known
repositories as candidates in the rejection, and create no task and no event. The repository a
task resolved to SHALL be readable on the task, so what was inferred is never invisible.

#### Scenario: AC-1047 — The request carries a URL

- **WHEN** a create request's text contains a repository URL and the request names no repository of its own
- **THEN** the task SHALL be created against that repository

#### Scenario: AC-1048 — The request names a known repository

- **WHEN** a create request's text names exactly one repository the system has already run a task against, and carries no URL
- **THEN** the task SHALL be created against that repository

#### Scenario: AC-1049 — Nothing resolves

- **WHEN** a create request's text names no repository, carries no URL, and no default repository is set
- **THEN** the API SHALL reject it naming the repository field, the rejection SHALL carry the known repositories as candidates, and no task SHALL be created

#### Scenario: AC-1050 — Two known repositories match

- **WHEN** a create request's text names two known repositories
- **THEN** intake SHALL reject it rather than choose one, and the rejection SHALL carry both as candidates

### Requirement: REQ-1017 — The repositories the system knows are readable, and one may be the default

The API SHALL expose the repositories the system has run tasks against, most recently used
first, naming which of them is the current default, and SHALL accept an authenticated update
setting or clearing the default repository. The default MAY name a repository no task has run
against — otherwise a fresh install could never set one — and SHALL appear in the list even when
nothing has run against it; a malformed repository URL MUST be rejected naming the offending
field. The list SHALL be readable before any task exists, in which case it SHALL carry the
default alone, or be empty rather than absent.

#### Scenario: AC-1051 — Reading the known repositories

- **WHEN** the repository list is read after tasks have run against two repositories
- **THEN** the response SHALL carry both, most recently used first, with the default marked if one is set

#### Scenario: AC-1052 — Setting the default

- **WHEN** an update names a known repository as the default
- **THEN** a create request that resolves nothing else SHALL afterwards be created against that repository

#### Scenario: AC-1053 — Default set before anything has run

- **WHEN** an update names a well-formed repository URL on an install where no task has run
- **THEN** it SHALL be accepted, the list SHALL carry it as the default, and the next launch naming no repository SHALL be created against it

#### Scenario: AC-1054 — Default is not a repository URL

- **WHEN** an update names a value that is not a well-formed repository URL
- **THEN** the API SHALL reject it naming the offending field and the stored default SHALL remain unchanged

#### Scenario: AC-1055 — Nothing has run and no default is set

- **WHEN** the repository list is read on a fresh install with no default set
- **THEN** the response SHALL be an empty list, not an error
