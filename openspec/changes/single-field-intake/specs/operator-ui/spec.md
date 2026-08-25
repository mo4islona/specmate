## ADDED Requirements

### Requirement: REQ-922 — Settings carries the default repository

The Settings screen SHALL carry a section naming the repositories the system knows and which of
them is the default for a launch that names none, with a control changing the default and a
control clearing it. The section SHALL let the owner name a repository nothing has run against
yet, so a fresh install can be pointed at one before its first launch. A saved change SHALL apply
to the next launch without restarting any service.

#### Scenario: AC-973 — Choosing the default repository

- **WHEN** the owner sets a repository as the default in Settings and then launches a task whose request names no repository
- **THEN** the task SHALL be created against that repository

#### Scenario: AC-974 — No repository known yet

- **WHEN** Settings is opened on an install where no task has run
- **THEN** the section SHALL state that nothing has run yet and SHALL still let the owner name a repository as the default, rather than render a choice with nothing in it
