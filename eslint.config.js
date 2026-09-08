import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'reference'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Enforce the sim purity boundary: src/sim/** must be pure TypeScript.
    // No renderer, no PixiJS, no impure globals, no nondeterministic APIs.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '**/render/**'],
              message: 'src/sim must stay pure TypeScript (no PixiJS / render imports)',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/sim must not touch browser globals' },
        { name: 'document', message: 'src/sim must not touch browser globals' },
        { name: 'performance', message: 'src/sim must use tick-based time only' },
        { name: 'setTimeout', message: 'src/sim must use tick-based time only' },
        { name: 'setInterval', message: 'src/sim must use tick-based time only' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'src/sim must use the seeded RNG' },
        { object: 'Date', property: 'now', message: 'src/sim must use tick-based time only' },
      ],
    },
  },
);
