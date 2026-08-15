import { stat } from 'node:fs/promises'

export async function pathExists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

export async function isDirectory(path: string): Promise<boolean> {
  const entry = await stat(path).catch(() => null)
  return entry?.isDirectory() ?? false
}
