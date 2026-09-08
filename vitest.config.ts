import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sim tests must run in a plain node environment: any accidental use of
    // browser globals (window/document) or PixiJS inside src/sim fails here.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
