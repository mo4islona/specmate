import { defineConfig } from 'vitest/config'

/**
 * The server-side suites that run on vitest (CLAUDE.md). `apps/web` keeps its
 * own config — it needs jsdom and the react plugin.
 *
 * `include` names them one by one rather than globbing every `test/`
 * directory. Vitest's workers are Node, and everything outside `packages/core`
 * reaches the Bun runtime — `SQL` from `bun` in `packages/db`, `Bun.spawn` and
 * `Bun.$` under the workspace and runner packages — so those suites stay on
 * `bun test` until the code beneath them stops needing it. A glob would sweep
 * them in and fail at import.
 */
export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    globals: false,
    restoreMocks: true,
    include: ['packages/core/test/**/*.test.ts'],
  },
})
