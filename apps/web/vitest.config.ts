import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The web app's tests run under vitest rather than `bun test`: a component
 * whose behavior *is* its interaction — an accordion, a collapsing chapter, a
 * document opening in place — cannot be asserted from server-rendered markup.
 * Everything outside apps/web has no DOM and stays on `bun test`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
})
