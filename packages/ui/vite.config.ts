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
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,    // remove console.* calls entirely
        drop_debugger: true,
        passes: 2,             // run compression twice for slightly smaller output
      },
      format: {
        comments: false,       // strip ALL comments, including /*! legal */ banners
      },
      mangle: true,
    },
    cssMinify: true,           // minify inlined CSS too
    reportCompressedSize: true,
  },
});