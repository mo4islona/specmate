import type { ExecutionEnvironment } from '@specmate/core'
import { ContainerRuntimeUnavailableError } from '@specmate/runner'
import type { Workspace } from '@specmate/workspace'

/**
 * Neither the task's pin nor the environment this deployment runs can be
 * resolved here. The stage fails naming the image it was pinned to, and the
 * task keeps that pin: nothing was substituted, so nothing should read as if it
 * had been (AC-818).
 */
export class EnvironmentUnresolvableError extends Error {
  constructor(
    readonly image: string,
    readonly detail: string,
  ) {
    super(
      `the pinned runner image ${image} cannot be resolved on this host, and neither can the one this deployment runs: ${detail}`,
    )
    this.name = 'EnvironmentUnresolvableError'
  }
}

/**
 * The host could not be asked whether the pin resolves, so nothing about the pin
 * has been established. Distinct from `EnvironmentUnresolvableError`, which is
 * an answer: a daemon mid-restart is a wait, a missing image is a re-pin, and
 * only the second is settled enough to end a task on.
 */
export class EnvironmentUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`the environment for this stage could not be established: ${detail}`)
    this.name = 'EnvironmentUnavailableError'
  }
}

export type StageEnvironment = (
  taskId: string,
  workspace: Workspace,
) => Promise<ExecutionEnvironment>

export interface StageEnvironmentDeps {
  /** The environment as the task records it. */
  readonly pinned: (taskId: string) => Promise<ExecutionEnvironment>
  /** Whether the host that must run the stage can resolve this reference. */
  readonly resolvesImage: (image: string) => Promise<boolean>
  /** Re-pins the task to the environment this deployment currently runs. */
  readonly repin: (taskId: string, workspace: Workspace) => Promise<ExecutionEnvironment>
}

/**
 * The pin a stage runs on, verified against the host that has to honour it.
 *
 * REQ-802 pins the environment so a task's later stages run on what its earlier
 * ones did, and that holds wherever the pin still resolves — an untouched pin is
 * returned whatever the configured default has since become. What the pin cannot
 * do is make a digest fetchable: the image is built on the deployment host and
 * published nowhere, so the build that supersedes it collects the manifest the
 * pin names, and no rebuild reproduces it.
 *
 * Between continuing on the environment the deployment now runs and stopping
 * forever, continuing is the weaker guarantee and the better outcome — provided
 * the substitution is recorded, which is what `repin` does.
 */
export function createStageEnvironment(deps: StageEnvironmentDeps): StageEnvironment {
  return async (taskId, workspace) => {
    const pinned = await deps.pinned(taskId)

    let resolves: boolean
    try {
      resolves = await deps.resolvesImage(pinned.image)
    } catch (error) {
      // The runtime did not answer. Re-pinning here would spend the pin on an
      // outage, and failing the task would end a healthy one for a restart that
      // overlapped it — so this reports a wait and the attempt cap decides.
      if (error instanceof ContainerRuntimeUnavailableError) {
        throw new EnvironmentUnavailableError(error.message)
      }

      throw error
    }
    if (resolves) return pinned

    try {
      return await deps.repin(taskId, workspace)
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        throw new EnvironmentUnavailableError(error.message)
      }

      throw new EnvironmentUnresolvableError(pinned.image, (error as Error).message)
    }
  }
}
