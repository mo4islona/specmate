## ADDED Requirements

### Requirement: REQ-1900 — The launch screen shows what the request resolves to, as it is written

The launch screen SHALL show, beside the request field and updating as the request is written,
what a launch of that text would do and what the system already holds about where it would go:

- the target repository and the rule that resolved it, or — where nothing resolves — that nothing
  does and what would make it resolve;
- the GitHub references the request carries, each linking to what it names — a reference written
  as a link SHALL be shown whether or not it can be read, and one inferred from shorthand SHALL be
  shown only once it reads, because `owner/repo#1` and a path are the same shape and only the read
  tells them apart;
- the specification convention in force for that repository, what that repository remembers, the
  coverage gap accepted for it if any, and the tasks that have already run against it.

A repository the system has run nothing against SHALL NOT be reported as simply unknown: what
governs it is determined mechanically and shown, and where it could not be determined the screen
SHALL say that rather than state that the repository has no specification.

What the screen names as the target repository SHALL be the repository a launch of the same text
creates the task against. The screen MUST NOT resolve the repository itself: it SHALL show what
intake resolves (REQ-1016), so the two cannot disagree.

Where more than one repository matches the request, the screen SHALL offer those repositories as a
choice and SHALL carry the chosen one on the launch, which is the same field a rejection's choice
fills (AC-972). A choice made this way SHALL be shown as chosen and SHALL be releasable, so a
stale choice cannot silently outrank a repository the request has since named.

A request that names no repository at all SHALL report nothing: no choice, and no statement that
nothing resolved. The repositories the system knows are not what such a request meant, and putting
them on screen turns the one field this screen has back into a form with a repository picker on
it; warning about the state is worse still, because it is a warning about not having finished
typing. Intake's own rejection is what catches a launch made anyway (AC-972), at the moment it
matters.

Every fact shown SHALL link to where it is read in full or where it is changed, and no fact shown
SHALL be editable here: this screen reports what the system holds and launches work against it.

#### Scenario: AC-1900 — The request names a repository

- **WHEN** the owner writes a request naming a repository, by link or by name, and submits nothing
- **THEN** the screen SHALL name the repository that request resolves to and the rule that resolved it

#### Scenario: AC-1901 — More than one repository matches

- **WHEN** the request names two repositories the system knows
- **THEN** the screen SHALL offer both as a choice before anything is submitted, and launching after choosing one SHALL create the task against it without a rejection

#### Scenario: AC-1902 — A choice is released

- **WHEN** the owner chooses a repository and then releases that choice
- **THEN** the screen SHALL return to what the request text resolves to, and the launch SHALL carry no chosen repository

#### Scenario: AC-1903 — Nothing resolves

- **WHEN** the request names no repository and no default is set
- **THEN** the screen SHALL report no repository at all — no choice, no warning — and SHALL show nothing beside the request where it has nothing else to report either

#### Scenario: AC-1904 — An issue in the request

- **WHEN** the request carries a GitHub issue reference
- **THEN** the screen SHALL show that issue's number, title and state, linking to the issue itself

#### Scenario: AC-1905 — An issue that cannot be read

- **WHEN** a GitHub issue reference written as a link cannot be read, for any reason
- **THEN** the reference SHALL remain shown as a link, with one line saying why it could not be read, and the launch SHALL be unaffected

#### Scenario: AC-1912 — A repository with no history here

- **WHEN** the request resolves to a repository the system has run no task against
- **THEN** the screen SHALL show what governs it, determined from its tree, and SHALL say when that could not be determined

#### Scenario: AC-1911 — Shorthand that names nothing

- **WHEN** the request contains text of the form `owner/repo#1` that turns out to name no issue
- **THEN** it SHALL NOT be shown as a reference

#### Scenario: AC-1906 — What the repository already holds

- **WHEN** the request resolves to a repository the system has run tasks against
- **THEN** the screen SHALL show the specification convention in force for it, what it remembers, the coverage gap accepted for it if any, and the tasks that ran against it, each linking to where it is read in full or changed

### Requirement: REQ-1901 — What the launch screen shows settles; it does not jump

The launch screen MUST NOT move, resize, or interrupt the request field on account of anything it
is showing beside it. Specifically:

- the panel MUST NOT draw a wait for an answer nobody has asked for: until a first answer exists it
  SHALL show nothing at all. Slots that fill only once the owner types are a promise the screen
  cannot keep — what they are short of is not a response but a request — and they read as a panel
  that is stuck rather than one that is filling. A section MAY draw a wait for a read that is
  already in flight against an answer the panel is holding;
- a panel with nothing to report SHALL show nothing, rather than an empty frame;
- where a default repository is set, an empty request SHALL show that repository rather than a
  placeholder — an empty request genuinely resolves to it;
- while a newer answer is being fetched, the previous answer SHALL remain shown and be marked as
  being refreshed, rather than be cleared or replaced by a loading state;
- what is shown SHALL settle into place, and MUST do so without motion where the reader has asked
  for reduced motion.

#### Scenario: AC-1907 — Before the first answer arrives

- **WHEN** the launch screen is opened and no answer about the request has arrived yet
- **THEN** the panel SHALL show nothing at all, rather than slots standing in for an answer that only a keystroke will produce

#### Scenario: AC-1908 — An empty request with a default set

- **WHEN** the launch screen is opened with an empty request and a default repository set
- **THEN** the panel SHALL show that repository as what the request resolves to, not a placeholder

#### Scenario: AC-1909 — A refresh in flight

- **WHEN** the request is edited while the previous answer is still shown
- **THEN** that answer SHALL remain shown, marked as being refreshed, until the newer one replaces it

#### Scenario: AC-1910 — Typing is never interrupted

- **WHEN** an answer arrives while the owner is typing
- **THEN** neither the focus nor the caret nor the position of the request field SHALL change
