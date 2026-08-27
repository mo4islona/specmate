import type { DiffFileSummary } from '../lib/api-client.ts'
import { type DirectoryGroup, fileName, shortDirectory } from '../lib/diff-tree.ts'
import { FolderName, Icon, NavRow } from '../ui/index.ts'
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
        <section key={group.directory} className="mt-3 min-w-0 first:mt-2">
          {group.directory !== '' && (
            <FolderName className="mb-0.5 truncate" title={group.directory}>
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
                  className="flex min-w-0 items-center gap-2"
                >
                  {/* The tick keeps its room whether or not it is drawn. Put in
                      the line only once it is earned, it shifted the name beside
                      it a character to the right the moment the file was read,
                      and the column lost its edge one row at a time. */}
                  <span className="flex w-3 shrink-0 justify-center">
                    {viewed.has(file.path) && (
                      <Icon name="check" size="xs" label="viewed" className="text-muted" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {fileName(file.path)}
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
