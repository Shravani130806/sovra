import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Resolve workspace imports through the ROOT base config: it owns the `paths`
// map to vendored/workspace `src`, and a package-local tsconfig that merely
// `extends` it does not carry those relative paths over.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../../tsconfig.base.json'] })],
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    globals: true,
    // Component suites render real React into a DOM. Store suites are pure and
    // unaffected; jsdom is cheap enough not to warrant splitting projects.
    environment: 'jsdom',
    css: true,
  },
})
