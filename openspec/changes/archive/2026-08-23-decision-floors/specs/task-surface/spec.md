## ADDED Requirements

### Requirement: REQ-1015 — Repositories, and the coverage waiver in force for each

The API SHALL expose the repositories this system has tasks against, each identified by a stable,
URL-safe identity derived from its remote, and each carrying the owner's acceptance of its
coverage gap when one is in force — naming the task whose resolution accepted it and when. It
SHALL accept an authenticated revocation of one repository's acceptance, after which that
repository SHALL no longer report one. Revoking where none is in force SHALL be reported as a
structured error, never as a silent success.

#### Scenario: AC-1043 — Reading what is in force

- **WHEN** the repositories are read
- **THEN** each SHALL carry its acceptance if one is in force, naming the task it came from, and nothing where none is

#### Scenario: AC-1044 — Revoking one

- **WHEN** a repository's acceptance is revoked
- **THEN** a subsequent read SHALL report that repository as carrying none, and a task against it afterward SHALL be asked rather than inherit it

#### Scenario: AC-1045 — Revoking what is not there

- **WHEN** a revocation names a repository with no acceptance in force
- **THEN** the API SHALL respond with a structured error
