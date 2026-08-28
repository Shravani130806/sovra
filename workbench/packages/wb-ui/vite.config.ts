import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mrpl/dsh-workbench-types': resolve(__dirname, 'src/dev/wb-types-mock.ts'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
})
