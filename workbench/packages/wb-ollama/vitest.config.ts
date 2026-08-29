import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Resolve workspace imports through the ROOT base config: it owns the `paths`
// map to vendored/workspace `src`, and a package-local tsconfig that merely
// `extends` it does not carry those relative paths over. Without this a
// package-local `pnpm test` cannot resolve `@deepseek-ai/cordis` at all.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../../tsconfig.base.json'] })],
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
  },
})
