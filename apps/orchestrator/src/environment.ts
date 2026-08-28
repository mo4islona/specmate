import type { ExecutionEnvironment } from '@specmate/core'
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
    if (await deps.resolvesImage(pinned.image)) return pinned

    try {
      return await deps.repin(taskId, workspace)
    } catch (error) {
      throw new EnvironmentUnresolvableError(pinned.image, (error as Error).message)
    }
  }
}
