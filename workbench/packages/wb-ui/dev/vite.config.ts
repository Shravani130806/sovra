import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const parentSrc = resolve(__dirname, '..', 'src')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mrpl/dsh-workbench-types': resolve(__dirname, 'src', 'wb-types-mock.ts'),
      '@client': resolve(parentSrc, 'client'),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
})
