// Applies the standard TypeScript ESLint rules to source and tests.
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'client/dist/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  ...tseslint.configs.recommended,
];
