## ADDED Requirements

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

## RENAMED Requirements

- FROM: `### Requirement: REQ-1202 — Requests become records, matched by node and key`
- TO: `### Requirement: REQ-1202 — Requests become records, matched by identity`

## MODIFIED Requirements

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
