import type { DiffFileSummary } from '../lib/api-client.ts'
import { type DirectoryGroup, fileName, shortDirectory } from '../lib/diff-tree.ts'
import { FolderName, NavRow } from '../ui/index.ts'
import { StatCounts } from './diff-file-facts.tsx'

interface FileListProps {
  readonly groups: readonly DirectoryGroup[]
  readonly selected: string | null
  readonly viewed: ReadonlySet<string>
  readonly onSelect: (file: DiffFileSummary) => void
}

/**
 * The files of one half of the comparison, under the directories that hold
 * them. Two levels, always: see `groupByDirectory` for why it is not a tree.
 */
export function FileList({ groups, selected, viewed, onSelect }: FileListProps) {
  return (
    <div className="min-w-0">
      {groups.map((group) => (
        <section key={group.directory} className="mt-2 min-w-0 first:mt-1">
          {group.directory !== '' && (
            <FolderName className="truncate ps-0.5" title={group.directory}>
              {shortDirectory(group.directory)}
            </FolderName>
          )}

          <ul className="min-w-0">
            {group.files.map((file) => (
              <li key={file.path} className="min-w-0">
                <NavRow
                  active={selected === file.path}
                  onClick={() => onSelect(file)}
                  title={file.path}
                  className="flex min-w-0 items-baseline justify-between gap-2"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5 ps-2">
                    <span
                      aria-hidden="true"
                      className={viewed.has(file.path) ? 'text-[0.6rem] text-muted' : 'sr-only'}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs">
                      {fileName(file.path)}
                    </span>
                  </span>

                  <StatCounts file={file} />
                </NavRow>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
