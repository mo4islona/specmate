import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workspace } from '@specmate/workspace'

export type ChangeFileRead =
  | { readonly content: string }
  | { readonly content: null; readonly detail: string }

/** Reads a file from the task's change folder, or a caller-facing detail when it is missing. */
export async function readChangeFile(
  workspace: Workspace,
  filename: string,
): Promise<ChangeFileRead> {
  const content = await readFile(join(workspace.path, workspace.changeDir, filename), 'utf8').catch(
    () => null,
  )
  if (content === null)
    return { content: null, detail: `${filename} was not found in the change folder` }

  return { content }
}
