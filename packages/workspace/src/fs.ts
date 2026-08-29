import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export async function pathExists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null
}

export async function isDirectory(path: string): Promise<boolean> {
  const entry = await stat(path).catch(() => null)
  return entry?.isDirectory() ?? false
}

/** Every markdown file under `dir`, absolute; a directory that is not there is empty. */
export async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(full)))
    } else if (entry.name.endsWith('.md')) {
      files.push(full)
    }
  }

  return files
}
