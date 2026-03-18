import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    sourcemap: true,
    clean: false, // keep .node binaries in dist/
    deps: {
      neverBundle: ['node:module', 'node:path', 'node:url', 'node:util', 'node:os', 'node:fs/promises', 'node:process'],
    },
    banner(chunk) {
      if (chunk.fileName.startsWith('cli')) return '#!/usr/bin/env node';
    },
  },

  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    testTimeout: 30000,
  },
});
