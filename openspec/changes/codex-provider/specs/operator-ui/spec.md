## RENAMED Requirements

- FROM: `### Requirement: REQ-917 — A Settings screen holds model defaults, built to grow`
- TO: `### Requirement: REQ-917 — A Settings screen holds provider and model defaults, built to grow`

## MODIFIED Requirements

### Requirement: REQ-917 — A Settings screen holds provider and model defaults, built to grow

The client SHALL provide a Settings screen organized into named sections, so a later setting
becomes a new section without restructuring the screen. Its first section SHALL let the owner
view and change the default provider, model and reasoning effort assigned to each role, reading from
and saving to the model-defaults setting; a saved change SHALL take effect for tasks created
afterward without restarting any service. The section SHALL offer a reset action that restores
every role to the shipped hardcoded defaults in one save.

A role's model choices SHALL be those of the provider currently selected for it, and changing the
provider SHALL leave that role naming a model the new provider offers. The screen MUST NOT be able
to submit a provider paired with a model that provider cannot run — a pairing REQ-1014 rejects is
one the owner should never have been offered.

#### Scenario: AC-946 — Changing a role's default model

- **WHEN** the owner changes one role's default model or reasoning effort in Settings and saves
- **THEN** a task subsequently created without an override for that role SHALL run it under the new default

#### Scenario: AC-947 — Settings screen reachable by direct URL

- **WHEN** the Settings screen's URL is opened directly in a fresh browser
- **THEN** the model defaults editor SHALL load without navigating through the inbox first

#### Scenario: AC-949 — Resetting to the shipped defaults

- **WHEN** the owner triggers the reset action after having changed one or more roles away from the shipped defaults
- **THEN** every role's stored default SHALL return to the shipped hardcoded provider, model and reasoning effort, and a task subsequently created without an override SHALL run under those restored values

#### Scenario: AC-1809 — Changing a role's provider

- **WHEN** the owner changes one role's provider in Settings
- **THEN** that role's model choices SHALL become the new provider's, the role SHALL name one of them, and saving SHALL be accepted
