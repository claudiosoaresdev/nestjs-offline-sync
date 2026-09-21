import { fileURLToPath } from 'node:url'

import 'dotenv/config'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
})
