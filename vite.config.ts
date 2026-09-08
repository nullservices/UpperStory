import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project under /UpperStory/; local development
  // and other hosts continue to use the root path.
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
