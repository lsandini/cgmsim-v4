import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@cgmsim/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@cgmsim/simulator': resolve(__dirname, '../simulator/src/index.ts'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
