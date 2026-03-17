import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: 'src/index.ts',
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    sourcemap: true,
    clean: false, // keep .node binaries in dist/
    deps: {
      neverBundle: ['node:module', 'node:path', 'node:url'],
    },
  },

  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
