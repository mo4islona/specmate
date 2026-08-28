/**
 * What every write endpoint accepts, in one place. A request shape is part of
 * the contract rather than of the handler that happens to read it, and several
 * of these are shared between the launch path and the rail that previews it.
 */
import {
  incoherentBindings,
  ModelBindingsOverride,
  PlanSize,
  SpecConventionSetting,
  TaskState,
} from '@specmate/core'
import { z } from 'zod'

/**
 * A provider and a model are wrong together rather than wrong alone (REQ-112),
 * so the pair is checked after each field has parsed, and the failure is
 * reported against the model — the field that does not belong to the provider
 * the request chose.
 */
const CoherentBindings = ModelBindingsOverride.superRefine((override, ctx) => {
  for (const field of incoherentBindings(override)) {
    const [role, key] = field.split('.')
    ctx.addIssue({
      code: 'custom',
      path: [role as string, key as string],
      message: `${override[role as keyof typeof override]?.model} is not a model ${override[role as keyof typeof override]?.provider} runs`,
    })
  }
})

export const CreateTask = z.object({
  // The request is the only thing a launch must carry: everything else is
  // resolved from it, or declared later by planning (REQ-1001).
  description: z
    .string()
    .trim()
    .min(1)
    // .max() counts UTF-16 code units, not bytes — this task's request text
    // feeds the ledger's byte-capped budget (packages/runner/src/ledger.ts),
    // so the cap has to be measured the same way or non-Latin scripts could
    // blow the whole budget on this one field.
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 20_000, {
      message: 'description must not exceed 20,000 bytes',
    }),
  title: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['feature', 'bugfix']).optional(),
  repoUrl: z.url().optional(),
  baseBranch: z.string().trim().min(1).optional(),
  // The owner declaring how much process the work gets, before anyone has read
  // the code. Absent is `auto`: planning declares it instead (REQ-1306).
  planSize: PlanSize.optional(),
  modelBindings: CoherentBindings.optional(),
})

/**
 * The same text a create request carries, and nothing is required: an empty
 * request is a legal thing to ask about, and its answer is the default
 * repository (AC-1908).
 */
export const PreviewIntake = z.object({
  description: z.string().max(20_000).default(''),
  /** A repository the owner pinned in the rail — the field a rejection's choice fills. */
  repoUrl: z.url().optional(),
})

/**
 * A reference is addressed by its parts, never by a URL the caller supplies:
 * the only requests that leave this process are ones assembled from these four
 * fields (AC-1073).
 */
export const ReadReference = z.object({
  host: z.string().trim().min(1).max(253),
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  number: z.coerce.number().int().positive(),
  kind: z.enum(['issue', 'pull']).default('issue'),
})

/** Addressed by the remote, because a repository with no history has no id to be addressed by. */
export const ProbeRepository = z.object({ repoUrl: z.url() })

export const UpdateModelDefaults = CoherentBindings

/** `null` clears it. A repository nothing has run against is a legal default (REQ-1017). */
export const UpdateDefaultRepository = z.object({ repoUrl: z.url().nullable() })

/** `setting: null` returns the repository to detection (REQ-923). */
export const UpdateSpecConvention = z.object({
  repoUrl: z.url(),
  setting: SpecConventionSetting.nullable(),
})

export const CreateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
  stageId: z.uuid().optional(),
})

export const CreateConversation = z.object({
  subjectKind: z.string().trim().min(1).max(64).optional(),
  subjectId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
})

export const CreateConversationMessage = z.object({
  message: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(1).max(200),
})

export const GateComment = z.object({
  comment: z.string().trim().min(1).max(20_000),
})

export const ReworkGate = GateComment.extend({
  target: TaskState,
})

export const AnswerDecision = z
  .object({
    optionId: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((v) => v.optionId || v.text, {
    message: 'optionId or text is required',
    path: ['text'],
  })

export const DismissDecision = z.object({
  reason: z.string().trim().max(20_000).optional(),
})

export const ConfirmConversationAction = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
})

export const StopStage = z.object({
  stageId: z.uuid(),
  graphId: z.uuid(),
  nodeKey: TaskState,
  attempt: z.number().int().nonnegative(),
})

export const RestartStage = z.object({
  stageId: z.uuid(),
  guidance: z.string().trim().max(20_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
})

export const FileDiffQuery = z.object({
  path: z.string().trim().min(1),
  // Unbounded here on purpose: a width past the ceiling is served at the
  // ceiling rather than refused (REQ-1013/AC-1063), so clamping belongs to
  // the read, not to validation.
  context: z.coerce.number().int().min(0).optional(),
})
