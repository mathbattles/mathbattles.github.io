import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths let the same build work at the site root or under a folder.
  base: './',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
});
