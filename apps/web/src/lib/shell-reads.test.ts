import { describe, expect, it } from 'vitest'
import { isReadOnlyShell } from './shell-reads.ts'

describe('isReadOnlyShell', () => {
  it.each([
    "sed -n '1,140p' packages/react/src/helpers/mount-chart.tsx",
    'tail -40 /tmp/workspaces/task/output.log',
    'cat package.json',
    'head -c 200 README.md',
    'ls -la apps/web/src',
    'find apps/web/src -iname "*.test.tsx"',
    'rg -n "useTaskStream" apps/web/src',
    'wc -l apps/web/src/index.css',
    'git status --short',
    'git -C apps/web log --oneline -5',
    'git diff HEAD~1',
  ])('reads: %s', (command) => {
    expect(isReadOnlyShell(command)).toBe(true)
  })

  it.each([
    'bun run test',
    'rm -rf node_modules',
    'git commit -m "wip"',
    'git checkout -b feat/x',
    'npm install',
    'mkdir -p apps/web/src/ui',
    'chmod +x deploy.sh',
    'node --eval "process.exit(0)"',
  ])('does not read: %s', (command) => {
    expect(isReadOnlyShell(command)).toBe(false)
  })

  it('reads a whole chain only when every command in it reads', () => {
    expect(
      isReadOnlyShell(
        `sed -n '1,140p' helpers/mount-chart.tsx 2>/dev/null || find helpers -iname "mount-chart*"`,
      ),
    ).toBe(true)
    expect(isReadOnlyShell('cat package.json | jq .name')).toBe(true)
    expect(isReadOnlyShell('cat package.json && rm package.json')).toBe(false)
  })

  it('reads a separator inside quotes as text, not as another command', () => {
    expect(isReadOnlyShell(`grep 'a || b' apps/web/src/index.css`)).toBe(true)
    expect(isReadOnlyShell(`rg "; rm -rf /" apps/web/src`)).toBe(true)
  })

  it('a redirection into a file is a write, /dev/null and a descriptor are not', () => {
    expect(isReadOnlyShell('cat package.json > copy.json')).toBe(false)
    expect(isReadOnlyShell('ls apps >> listing.txt')).toBe(false)
    expect(isReadOnlyShell('find . -name "*.ts" 2>/dev/null')).toBe(true)
    expect(isReadOnlyShell('git status 2>&1')).toBe(true)
    expect(isReadOnlyShell('sort < names.txt')).toBe(true)
  })

  it("sed's in-place flag is the whole difference", () => {
    expect(isReadOnlyShell(`sed -n '2p' file.ts`)).toBe(true)
    expect(isReadOnlyShell(`sed -i '' 's/a/b/' file.ts`)).toBe(false)
    expect(isReadOnlyShell(`sed -i.bak 's/a/b/' file.ts`)).toBe(false)
    expect(isReadOnlyShell(`sed --in-place 's/a/b/' file.ts`)).toBe(false)
  })

  it('find is a walk until it is told to act', () => {
    expect(isReadOnlyShell('find . -name "*.tmp"')).toBe(true)
    expect(isReadOnlyShell('find . -name "*.tmp" -delete')).toBe(false)
    expect(isReadOnlyShell('find . -name "*.tmp" -exec rm {} ;')).toBe(false)
  })

  it('only git subcommands it knows to be reads count as reads', () => {
    expect(isReadOnlyShell('git show HEAD:apps/web/package.json')).toBe(true)
    expect(isReadOnlyShell('git push origin main')).toBe(false)
    expect(isReadOnlyShell('git config user.name someone')).toBe(false)
  })

  it('a command it cannot see into is never a read', () => {
    expect(isReadOnlyShell('echo $(rm -rf build)')).toBe(false)
    expect(isReadOnlyShell('cat `which node`')).toBe(false)
    expect(isReadOnlyShell('')).toBe(false)
  })

  it('reads through leading environment assignments and an absolute path', () => {
    expect(isReadOnlyShell('LC_ALL=C /usr/bin/sort names.txt')).toBe(true)
    expect(isReadOnlyShell('LC_ALL=C /usr/bin/rm names.txt')).toBe(false)
  })
})
