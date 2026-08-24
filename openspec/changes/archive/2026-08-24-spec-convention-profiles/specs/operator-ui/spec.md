## ADDED Requirements

### Requirement: REQ-923 — Settings holds each repository's spec convention

The Settings screen SHALL carry a section for the spec convention profile of each repository the
owner has set one for, naming the repository and the profile in force, with controls to change it
and to remove it so detection governs again. Where the owner has set none, the section SHALL say
that detection is in force rather than render an empty list.

Choosing the profile that names a configured suite location SHALL require that location before the
setting can be saved, and SHALL accept a short note describing the convention that suite follows.
A saved change SHALL govern tasks created afterwards without restarting any service.

#### Scenario: AC-975 — Reviewing what is set

- **WHEN** the owner opens Settings with a spec convention set for a repository
- **THEN** the section SHALL name that repository and the profile in force

#### Scenario: AC-976 — Setting a profile

- **WHEN** the owner sets a repository's profile and saves
- **THEN** a task subsequently created against that repository SHALL run under it

#### Scenario: AC-977 — A configured suite needs a location

- **WHEN** the owner selects the profile naming a configured suite location without providing one
- **THEN** the setting SHALL NOT save, and the screen SHALL say what is missing

#### Scenario: AC-978 — Returning a repository to detection

- **WHEN** the owner removes a repository's profile from the section
- **THEN** it SHALL leave the list, and the next task against that repository SHALL run under the detected profile

#### Scenario: AC-979 — Nothing set

- **WHEN** no repository has a spec convention set
- **THEN** the section SHALL say that detection is in force
