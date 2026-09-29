import { defineConfig } from 'vite';

// Static site. `npm run build` -> dist/. Relative base so the build works from any path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
});
