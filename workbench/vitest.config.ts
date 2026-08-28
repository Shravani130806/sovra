import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Workbench-level integration suites: real sibling plugins composed together.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../tsconfig.base.json'] })],
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
  },
})
