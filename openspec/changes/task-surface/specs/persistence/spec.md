## MODIFIED Requirements

### Requirement: Feedback is captured as structured signal

Every human correction — redirect, decision answer, spec edit, rework note, overruled
finding — and every free-form operator comment SHALL be stored with the task, the stage, the
role and provider it corrects, and the prompt versions in force at the time. The closed set
of feedback kinds SHALL include `comment` for commentary not tied to a gate verdict or a
decision answer. Capture MUST begin in Phase 0 even though nothing consumes it until the
Retro agent exists.

#### Scenario: Owner rejects a reviewer finding

- **WHEN** the owner overrules a finding
- **THEN** a feedback record SHALL be written naming the role, the provider, and the prompt versions in force

#### Scenario: Owner comments outside any gate

- **WHEN** the owner posts a free-form comment on a running task
- **THEN** a feedback record of kind `comment` SHALL be written, and the database SHALL accept `comment` as a legal feedback kind
