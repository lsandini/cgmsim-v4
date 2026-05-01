import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
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
    minify: false,
  },
});
