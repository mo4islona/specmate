import { z } from 'zod'

/**
 * Roles are fixed responsibilities; providers are interchangeable executors.
 * Every role consumes and produces OpenSpec artifacts — never free-form chat.
 */
export const AGENT_ROLES = [
  'planner',
  'researcher',
  'spec_writer',
  'implementer',
  'verifier',
  'reviewer',
  'summarizer',
  'answerer',
  'retro',
] as const

export const AgentRole = z.enum(AGENT_ROLES)
export type AgentRole = z.infer<typeof AgentRole>
/** Answer-only runs sit outside the pinned stage graph. */
export type PipelineRole = Exclude<AgentRole, 'answerer'>
export const PIPELINE_ROLES: readonly PipelineRole[] = AGENT_ROLES.filter(
  (role): role is PipelineRole => role !== 'answerer',
)

export const PROVIDERS = ['claude-code', 'codex', 'copilot'] as const

export const ProviderId = z.enum(PROVIDERS)
export type ProviderId = z.infer<typeof ProviderId>

/** Artifact kinds a role may read or write, relative to the change folder. */
export const ARTIFACT_KINDS = [
  'proposal',
  'spec',
  'design',
  'tasks',
  'review',
  'verification',
  'summary',
  'decision_log',
] as const

export const ArtifactKind = z.enum(ARTIFACT_KINDS)
export type ArtifactKind = z.infer<typeof ArtifactKind>

export interface RoleContract {
  readonly role: AgentRole
  /** Artifact kinds assembled into the prompt. */
  readonly reads: readonly ArtifactKind[]
  /** Artifact kinds the stage is allowed to create or modify. */
  readonly writes: readonly ArtifactKind[]
  /** May the stage modify files outside the change folder (i.e. product code)? */
  readonly writesCode: boolean
  /** Receives the house spec-standard skill in its context assembly (§11). */
  readonly injectSpecSkill: boolean
  /** Result must carry a verdict — a review-shaped stage (reviewer, verifier). */
  readonly returnsVerdict: boolean
  /** An approve verdict is cross-checked against committed evidence before it is accepted. */
  readonly corroborated: boolean
  readonly defaultProvider: ProviderId
  readonly promptFile: `roles/${string}.md`
}

export const ROLE_CONTRACTS: Readonly<Record<AgentRole, RoleContract>> = {
  planner: {
    role: 'planner',
    reads: [],
    writes: ['proposal'],
    writesCode: false,
    injectSpecSkill: false,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/planner.md',
  },
  researcher: {
    role: 'researcher',
    reads: ['proposal', 'decision_log'],
    writes: ['proposal', 'design', 'spec'],
    writesCode: false,
    injectSpecSkill: true,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/researcher.md',
  },
  spec_writer: {
    role: 'spec_writer',
    reads: ['proposal', 'design', 'spec', 'decision_log', 'review'],
    writes: ['spec', 'tasks'],
    writesCode: false,
    injectSpecSkill: true,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/spec-writer.md',
  },
  implementer: {
    role: 'implementer',
    reads: ['tasks', 'design', 'spec', 'decision_log', 'review'],
    writes: ['tasks'],
    writesCode: true,
    injectSpecSkill: false,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'codex',
    promptFile: 'roles/implementer.md',
  },
  verifier: {
    role: 'verifier',
    reads: ['spec', 'design', 'tasks'],
    writes: ['verification'],
    writesCode: true, // harness code ships in the same PR
    injectSpecSkill: false,
    returnsVerdict: true,
    corroborated: true,
    defaultProvider: 'codex',
    promptFile: 'roles/verifier.md',
  },
  reviewer: {
    role: 'reviewer',
    reads: ['proposal', 'design', 'spec', 'tasks', 'verification', 'decision_log'],
    writes: ['review'],
    writesCode: false,
    injectSpecSkill: true,
    returnsVerdict: true,
    corroborated: false,
    defaultProvider: 'codex',
    promptFile: 'roles/reviewer.md',
  },
  summarizer: {
    role: 'summarizer',
    reads: ['proposal', 'design', 'spec', 'tasks', 'verification', 'review', 'decision_log'],
    writes: ['summary'],
    writesCode: false,
    injectSpecSkill: true,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/summarizer.md',
  },
  answerer: {
    role: 'answerer',
    reads: ARTIFACT_KINDS,
    writes: [],
    writesCode: false,
    injectSpecSkill: false,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/answerer.md',
  },
  retro: {
    role: 'retro',
    reads: [],
    writes: ['proposal'],
    writesCode: false,
    injectSpecSkill: false,
    returnsVerdict: false,
    corroborated: false,
    defaultProvider: 'claude-code',
    promptFile: 'roles/retro.md',
  },
}

/**
 * Cross-model review: the reviewer must not be the provider that produced the
 * artifacts under review. Falls back to the first provider that differs.
 */
export function pickReviewProvider(
  writer: ProviderId,
  available: readonly ProviderId[] = PROVIDERS,
): ProviderId {
  const other = available.find((p) => p !== writer)
  return other ?? writer
}
