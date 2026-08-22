# decisions Specification

## Purpose

Defines the record behind every stop: what a decision is, when one must exist, how a request
from an agent and an escalation from the engine both become one, how the owner may discuss it
before explicitly resolving it, how resolution resumes the task, and how the change folder
carries the outcome into every later run. A parked task with nothing to resolve, a conversation
mistaken for consent, or an answer that never reaches the next prompt is the failure this
capability exists to prevent.

## Requirements

### Requirement: REQ-1201 — A parked task always has an open decision behind it

Whenever the orchestrator parks a task awaiting a human, at least one open decision explaining
the park SHALL exist for that task, whatever the cause. A task MUST NOT be left parked with
nothing open against it, and a parked task's reason for stopping SHALL be readable from its
open decisions alone, without replaying its event log. The stage attempt whose outcome led to
the park SHALL be recorded as awaiting the human rather than as a plain success, so the stage
history says which run stopped and why.

#### Scenario: AC-1201 — Task parks awaiting a human

- **WHEN** a task is parked awaiting a human for any cause
- **THEN** at least one open decision naming that cause SHALL exist for the task

#### Scenario: AC-1202 — The asking attempt in the stage history

- **WHEN** a stage's result requests a blocking decision and the task parks
- **THEN** that attempt SHALL be recorded as awaiting the human, not as a plain success, and its committed output SHALL be retained

#### Scenario: AC-1203 — Reading why a task stopped

- **WHEN** a parked task is inspected
- **THEN** its open decisions SHALL state what is being asked, without the reader consulting the event log

### Requirement: REQ-1202 — Requests become records, matched by identity

Every decision an agent requests SHALL become a durable record carrying the pinned-graph node
that raised it, the request's key, its kind, its rendered prompt, its offered options, and
whether it blocks progress. A request whose identity already matches an **open** decision SHALL
attach to that record rather than creating a second one, so a retried or repeated stage does not
multiply one question. That identity SHALL be the task and the key for a non-blocking question —
a question is about the work, not about the node that happened to raise it, and one question
SHALL be one record however many nodes ask it — and the node and the key for everything else,
because an escalation is about a node and two nodes escalating are two situations. A request
matching only a **resolved** decision SHALL create a new record: asking again once an answer
exists is a new question, and the earlier answer stays readable. A request marked non-blocking
SHALL be recorded and surfaced without parking the task.

#### Scenario: AC-1204 — A retry re-asks the same question

- **WHEN** a stage attempt fails and its retry requests the same key at the same node
- **THEN** one decision SHALL exist, still open, with its original prompt

#### Scenario: AC-1205 — The same key after an answer

- **WHEN** a later run at the same node requests a key whose decision was already answered
- **THEN** a new open decision SHALL be created and the answered one SHALL remain readable with its answer

#### Scenario: AC-1206 — A question that does not block

- **WHEN** a result carries a decision request marked non-blocking
- **THEN** the decision SHALL be recorded and listed, and the task SHALL continue along its pinned graph

#### Scenario: AC-1207 — The same key from two nodes

- **WHEN** two different nodes each raise a blocking or escalation request under the same key
- **THEN** they SHALL be two decisions, each carrying the node that raised it

#### Scenario: AC-1228 — The same question from two nodes

- **WHEN** stages at two different nodes each raise a non-blocking question under one key on the same task
- **THEN** one open decision SHALL exist, carrying the latest prompt, and the owner SHALL answer it once

### Requirement: REQ-1203 — The engine raises the escalation no agent asked for

When the orchestrator parks a task for a cause no agent requested — a review's escalate
verdict, a loop cap spent without approval, a finding repeated to its threshold — it SHALL
raise a decision of the escalation kind itself. The rendered prompt SHALL name the cause and
carry the evidence needed to answer it without opening the artifacts: the round's verdict and
findings for an escalated review, the loop identity and the cap for a spent cap, and the
repeated identifiers with the rounds they appeared in for a stalled loop. The key SHALL derive
from the cause and the round, so parking twice for one cause in one round raises one decision.

#### Scenario: AC-1208 — A loop cap is spent

- **WHEN** a loop reaches its configured cap without approval
- **THEN** an open escalation SHALL name the loop, its cap, and the round that spent it

#### Scenario: AC-1209 — A review escalates

- **WHEN** a reviewing stage returns an escalate verdict
- **THEN** the raised escalation SHALL carry that round's verdict and its findings

#### Scenario: AC-1210 — A finding will not go away

- **WHEN** the same finding identifier repeats to the configured threshold
- **THEN** the raised escalation SHALL name that identifier and the rounds it appeared in

### Requirement: REQ-1204 — Answering is one act, and it resumes the task

Answering an open decision SHALL, as one atomic step, record the answer with the answering
identity and the time, capture it as feedback of the decision-answer kind against the role and
provider of the stage that asked, and append an event. When the answered decision was the last
open blocking decision of a parked task, that same step SHALL return the task to the state it
was interrupted in. A parked task SHALL leave that state only by resolving its blocking
decisions or by being cancelled — never by an unexplained resume. Answering a decision that is
not open SHALL be rejected without changing anything, and an answer MUST carry a selected
option or non-empty text. Conversation messages and assistant proposals MUST NOT count as an
answer; only an explicit resolution operation may resolve the decision.

#### Scenario: AC-1211 — The last blocker is answered

- **WHEN** the last open blocking decision of a parked task is answered
- **THEN** the task SHALL return to the state it was interrupted in, in the same step that records the answer

#### Scenario: AC-1212 — One of several answered

- **WHEN** a parked task has two open blocking decisions and one is answered
- **THEN** the task SHALL stay parked and the other SHALL remain open

#### Scenario: AC-1213 — Answering twice

- **WHEN** an already-answered decision is answered again
- **THEN** it SHALL be rejected and the stored answer SHALL be unchanged

#### Scenario: AC-1214 — The answer is signal

- **WHEN** a decision raised by a stage is answered
- **THEN** a feedback record of the decision-answer kind SHALL hold the answer against that stage's role and provider

#### Scenario: AC-1215 — An answer with nothing in it

- **WHEN** an answer carries neither a selected option nor text
- **THEN** it SHALL be rejected and the decision SHALL stay open

### Requirement: REQ-1205 — The decision log is generated, never authored

The change folder SHALL carry a decision log rendering the task's stored decisions — each with
the node that raised it, its question, its options, and its answer or dismissal with who
resolved it and when — and the system SHALL regenerate it from the store before a stage runs,
so every prompt carries the answers in force. The store SHALL be authoritative: an edit an
agent leaves in the log MUST NOT be read back as an answer, and no role SHALL declare the log
among the artifacts it writes. The regenerated log SHALL be committed with the stage's output
like any other artifact change.

#### Scenario: AC-1216 — An answer reaches the next run

- **WHEN** a stage runs after a decision it needs was answered
- **THEN** the log in its assembled context SHALL contain that question and its answer

#### Scenario: AC-1217 — An agent edits the log

- **WHEN** a stage leaves modifications in the decision log
- **THEN** the next stage's log SHALL be the store's rendering, and nothing in the edit SHALL be treated as an answer

#### Scenario: AC-1218 — The workspace is rebuilt

- **WHEN** a task's workspace is discarded and re-provisioned
- **THEN** the decision log SHALL be reproduced from the store rather than lost with the tree

### Requirement: REQ-1206 — An open decision does not outlive its situation

A decision SHALL stop being open once what it blocks no longer exists. The owner MAY dismiss
an open decision instead of answering it, and a task reaching a terminal state SHALL dismiss
whatever it left open. Dismissal SHALL resolve a decision for the purpose of resuming a parked
task, SHALL be distinguishable from an answer wherever a decision is read, and SHALL be
recorded in the log as a dismissal rather than as an empty answer.

#### Scenario: AC-1219 — A task is cancelled with questions open

- **WHEN** a task carrying open decisions is cancelled
- **THEN** they SHALL be dismissed and SHALL no longer appear as needing the owner

#### Scenario: AC-1220 — Dismissed rather than answered

- **WHEN** the owner dismisses the last open blocking decision of a parked task
- **THEN** the task SHALL resume, and the decision SHALL read as dismissed rather than answered

### Requirement: REQ-1207 — Every decision can be discussed before resolution

Creating a decision SHALL also create exactly one conversation scoped to that decision, in the
same transaction, without starting an agent run. The discussion SHALL receive the decision's
prompt, options, evidence, and task context when the owner posts its first message. Owner and
assistant messages MAY explore or draft an answer but MUST NOT change decision status or resume
the task. The owner MAY explicitly confirm a proposed answer or use the decision's direct answer
or dismiss control; both paths SHALL delegate to the same resolution operation. The discussion
SHALL remain readable after resolution. Further messages MUST NOT edit the recorded outcome; a
different outcome requires a new explicit task action or decision.

#### Scenario: AC-1221 — A decision is raised but never discussed

- **WHEN** the orchestrator creates a decision and the owner posts no discussion message
- **THEN** its scoped conversation SHALL exist without consuming an agent run

#### Scenario: AC-1222 — The owner asks for clarification

- **WHEN** the owner posts a follow-up in an open decision's discussion
- **THEN** the response SHALL use the decision prompt, options, evidence, task artifacts, and prior discussion while the decision remains open

#### Scenario: AC-1223 — A proposed answer is not consent

- **WHEN** the assistant drafts or proposes an answer and the owner has not confirmed it
- **THEN** the decision SHALL remain open and a parked task SHALL remain parked

#### Scenario: AC-1224 — Discussion after resolution

- **WHEN** another message is posted after the decision was answered
- **THEN** the recorded answer SHALL remain unchanged and the message SHALL NOT resume, rewind, or otherwise transition the task

### Requirement: REQ-1208 — One stage may raise only so many questions

The number of non-blocking requests one stage result may turn into decisions SHALL be bounded by
a configured cap. Requests past the cap SHALL NOT become decisions, and the task's event log SHALL
record that they were refused together with their keys — a truncated question list MUST NOT be
indistinguishable from a short one. Blocking requests SHALL NOT be subject to the cap: each one is
the reason a task parks, and dropping one would leave a parked task with nothing open against it.

The cap SHALL apply to a non-blocking request whatever kind it declares. The kind is a field the
requesting agent writes, so a cap conditioned on it is one the agent can step over by relabelling
a question; only `blocking` — which the engine already acts on by parking the task — may exempt a
request.

#### Scenario: AC-1225 — More questions than the cap allows

- **WHEN** a stage result carries more non-blocking questions than the configured cap
- **THEN** at most the cap SHALL become open decisions, and the event log SHALL name the keys that did not

#### Scenario: AC-1226 — Blocking requests are never dropped

- **WHEN** a stage result carries blocking requests beyond the question cap
- **THEN** every blocking request SHALL become a decision, and the task SHALL park with them open

#### Scenario: AC-1227 — Within the cap

- **WHEN** a stage result carries no more questions than the cap allows
- **THEN** every one of them SHALL become a decision and nothing SHALL be recorded as refused

#### Scenario: AC-1229 — A non-blocking request of another kind

- **WHEN** a stage result carries non-blocking requests declaring a kind other than `question` beyond the cap
- **THEN** they SHALL be capped exactly as questions are, and the event log SHALL name the keys that did not become decisions
