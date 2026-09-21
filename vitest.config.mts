import { fileURLToPath } from 'node:url'

import 'dotenv/config'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: [
      'src/**/*.spec.ts',
      'test/architecture/**/*.spec.ts',
      'test/sync-protocol/**/*.spec.ts',
    ],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/**/*.module.ts'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
})
