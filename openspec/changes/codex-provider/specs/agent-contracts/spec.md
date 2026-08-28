## ADDED Requirements

### Requirement: REQ-112 — A role's binding names a provider, and a model that provider offers

A per-role binding SHALL name a provider, a model, and a reasoning effort. The model catalog SHALL
be declared per provider, and a binding whose model is not in its provider's catalog SHALL be
rejected wherever the binding is formed, naming the offending field. A model paired with a provider
that cannot run it is not a degraded binding; it is a run that fails at the command line, and it is
refused before it becomes one.

Where a binding is being resolved and only the provider was named, the model SHALL be resolved
against that provider: the current default's model where that provider offers it, and otherwise that
provider's own default model for the role. Naming a provider MUST NOT require naming a model in the
same breath, and MUST NOT silently keep a model belonging to the provider being replaced.

Where the provider a stage is dispatched under differs from the provider its task's binding names
for that role — which is what cross-provider checking produces by construction — the stage's model
SHALL be the dispatched provider's default model for that role. The binding's model belongs to a
different provider and SHALL NOT be carried across. The reasoning effort is not provider-specific
and SHALL be carried from the binding unchanged.

#### Scenario: AC-136 — A model outside the bound provider's catalog

- **WHEN** a binding is submitted naming a provider together with a model that provider's catalog does not contain
- **THEN** it SHALL be rejected naming the offending field, and no binding SHALL be stored

#### Scenario: AC-137 — A provider named without a model

- **WHEN** a binding override names a new provider for a role and no model
- **THEN** the resolved binding SHALL carry a model from that provider's catalog, never the model belonging to the provider it replaced

#### Scenario: AC-138 — A check dispatched under the other provider

- **WHEN** a checking node is dispatched under a provider other than the one its task's binding names for its role
- **THEN** the stage SHALL run that provider's default model for the role, carrying the binding's reasoning effort unchanged
