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
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,        // preserve dist/cgmsim-v4-standalone.html if it's there
    minify: 'terser',
    rollupOptions: {
      input: resolve(__dirname, 'index-mobile.html'),
    },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
      format: {
        comments: false,
      },
      mangle: true,
    },
    cssMinify: true,
    reportCompressedSize: true,
  },
});
